/**
 * MessageDispatcher — handles all WebView → extension messages.
 *
 * Extracted from extension.ts to keep activate() lean.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { refreshTasksCommand } from './commands/refreshTasks';
import { HiddenTasksStore } from './config/HiddenTasksStore';
import { LocalNotesStore } from './config/LocalNotesStore';
import { ProjectConfig } from './config/ProjectConfig';
import { DiffWatcher, gitRefUri } from './diff/DiffWatcher';
import { cancelAgent as cancelCliAgent, runAgent as runCliAgent } from './genai-provider/AgentRunner';
import type { CopilotLauncher } from './genai-provider/CopilotLauncher';
import type { GenAiProviderRegistry } from './genai-provider/GenAiProviderRegistry';
import type { SessionStateManager } from './genai-provider/SessionStateManager';
import type { SquadManager } from './genai-provider/SquadManager';
import { removeWorktree } from './genai-provider/WorktreeManager';
import type { PullRequestManager } from './github/PullRequestManager';
import type { KanbanPanel } from './kanban/KanbanPanel';
import type { JsonProvider } from './providers/JsonProvider';
import type { ProviderRegistry } from './providers/ProviderRegistry';
import { buildColumnOrder, DEFAULT_COLUMN_COLORS, DEFAULT_COLUMN_LABELS } from './types/ColumnId';
import type { KanbanTask } from './types/KanbanTask';
import type { AgentOption } from './types/Messages';
import { Logger } from './utils/logger';
import { handleStartSquad, handleToggleAutoSquad, sendTasksToPanel } from './utils/panelHelpers';
import { execPromise, isAzureDevOpsRepository, isGitHubRepository, isGitRepository, sendBranchesToPanel } from './utils/repoDetection';

export interface MessageDispatcherDeps {
  panel: KanbanPanel;
  providerRegistry: ProviderRegistry;
  genAiRegistry: GenAiProviderRegistry;
  squadManager: SquadManager;
  sessionStateManager: SessionStateManager;
  copilotLauncher: CopilotLauncher;
  jsonProvider: JsonProvider;
  prManager: PullRequestManager;
  agentOptions: () => AgentOption[];
  refreshAgents: () => void;
  refresh: () => void;
  pushMobileStatus: (panel: KanbanPanel) => Promise<void>;
}

export function wireMessageDispatcher(deps: MessageDispatcherDeps): void {
  const {
    panel,
    providerRegistry,
    genAiRegistry,
    squadManager,
    sessionStateManager,
    copilotLauncher,
    jsonProvider,
    prManager,
    agentOptions,
    refreshAgents,
    refresh,
    pushMobileStatus,
  } = deps;

  const logger = Logger.getInstance();

  // Clear any previously registered handlers to avoid duplicates on re-wire.
  panel.clearMessageHandlers();

  panel.onMessage(async (msg) => {
    switch (msg.type) {
      case 'ready':
        await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
        panel.updateSquadStatus(squadManager.getStatus());
        panel.updateAgents(agentOptions());
        panel.updateMcpStatus(ProjectConfig.getProjectConfig()?.mcp?.enabled ?? false);
        panel.postMessage({
          type: 'repoStatus',
          isGit: await isGitRepository(),
          isGitHub: await isGitHubRepository(),
          isAzureDevOps: await isAzureDevOpsRepository(),
          workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
          workspaceName: vscode.workspace.name ?? vscode.workspace.workspaceFolders?.[0]?.name ?? '',
        });
        await sendBranchesToPanel(panel);
        await pushMobileStatus(panel);
        break;

      case 'refreshRequest':
        try {
          await refreshTasksCommand(providerRegistry);
        } catch { /* logged in refreshTasksCommand */ }
        await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
        refreshAgents();
        panel.updateAgents(agentOptions());
        await sendBranchesToPanel(panel);
        await pushMobileStatus(panel);
        break;

      case 'taskMoved': {
        const provider = providerRegistry.get(msg.providerId);
        if (provider) {
          const tasks = await provider.getTasks();
          const task = tasks.find(t => t.id === msg.taskId);
          if (task) {
            await provider.updateTask({ ...task, status: msg.toCol });
          }
        }
        await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
        break;
      }

      case 'openCopilot':
        if (!(await isGitRepository())) {
          vscode.window.showWarningMessage('Agent Board: squad requires a git repository.');
          break;
        }
        await squadManager.launchSingle(msg.taskId, msg.providerId, msg.agentSlug, msg.baseBranch);
        panel.updateSquadStatus(squadManager.getStatus());
        await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
        break;

      case 'startSquad':
        if (!(await isGitRepository())) {
          vscode.window.showWarningMessage('Agent Board: squad requires a git repository.');
          break;
        }
        await handleStartSquad(squadManager, msg.agentSlug, msg.genAiProviderId, msg.baseBranch);
        panel.updateSquadStatus(squadManager.getStatus());
        await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
        break;

      case 'toggleAutoSquad':
        if (!(await isGitRepository())) {
          vscode.window.showWarningMessage('Agent Board: squad requires a git repository.');
          break;
        }
        handleToggleAutoSquad(squadManager, msg.agentSlug, msg.genAiProviderId, msg.baseBranch);
        panel.updateSquadStatus(squadManager.getStatus());
        break;

      case 'toggleMcp': {
        const currentMcp = ProjectConfig.getProjectConfig()?.mcp?.enabled ?? false;
        const newMcpEnabled = !currentMcp;
        ProjectConfig.updateConfig({ mcp: { enabled: newMcpEnabled } });
        panel.updateMcpStatus(newMcpEnabled);
        logger.info(`MCP server ${newMcpEnabled ? 'enabled' : 'disabled'} via board toggle`);
        break;
      }

      // Mobile-server-specific messages are handled inline in extension.ts
      // (they require direct mobileServer reference)
      case 'toggleMobileServer':
      case 'setMobileTunnelEnabled':
      case 'refreshMobileStatus':
      case 'openMobileCompanion':
        break;

      case 'addTask': {
        const columns = buildColumnOrder(ProjectConfig.getProjectConfig()?.kanban?.intermediateColumns).map(id => ({ id, label: DEFAULT_COLUMN_LABELS[id] ?? id, color: DEFAULT_COLUMN_COLORS[id] }));
        let currentUser = '';
        try {
          const ghSession = await vscode.authentication.getSession('github', ['repo'], { createIfNone: false });
          if (ghSession) { currentUser = ghSession.account.label; }
        } catch { /* no session */ }
        if (!currentUser) { currentUser = os.userInfo().username || 'me'; }
        panel.postMessage({ type: 'showTaskForm', columns, currentUser });
        break;
      }

      case 'saveTask': {
        const { title, body, status, labels, assignee } = msg.data;
        const task = await jsonProvider.createTask(title, body || undefined);
        const updates: Partial<KanbanTask> = { ...task };
        if (status) { updates.status = status; }
        if (labels) { updates.labels = labels.split(',').map((l: string) => l.trim()).filter(Boolean); }
        if (assignee) { updates.assignee = assignee; }
        if (updates.status !== task.status || (updates.labels && updates.labels.length > 0) || updates.assignee) {
          await jsonProvider.updateTask(updates as KanbanTask);
        }
        refresh();
        await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
        break;
      }

      case 'cancelTaskForm':
        break;

      case 'editTask': {
        const editProvider = providerRegistry.get(msg.providerId);
        if (editProvider) {
          const tasks = await editProvider.getTasks();
          const existing = tasks.find(t => t.id === msg.taskId);
          if (existing) {
            const { title, body, status, labels, assignee } = msg.data;
            const parsedLabels = labels ? labels.split(',').map((l: string) => l.trim()).filter(Boolean) : [];
            await editProvider.updateTask({
              ...existing,
              title,
              body,
              status: status || existing.status,
              labels: parsedLabels,
              assignee: assignee || undefined,
            });
          }
        }
        refresh();
        await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
        break;
      }

      case 'deleteTask': {
        const delProvider = providerRegistry.get(msg.providerId);
        if (delProvider && 'deleteTaskById' in delProvider && typeof (delProvider as Record<string, unknown>).deleteTaskById === 'function') {
          await (delProvider as unknown as { deleteTaskById(id: string): Promise<boolean> }).deleteTaskById(msg.taskId);
        }
        refresh();
        await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
        break;
      }

      case 'hideTask':
        HiddenTasksStore.hide(msg.taskId);
        await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
        break;

      case 'saveLocalNotes':
        LocalNotesStore.set(msg.providerId, msg.taskId, msg.notes);
        await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
        break;

      case 'exportDoneMd': {
        const configuredCols = buildColumnOrder(ProjectConfig.getProjectConfig()?.kanban?.intermediateColumns);
        const doneColId = configuredCols[configuredCols.length - 1] ?? 'done';
        const allProviders = providerRegistry.getAll().filter(p => p.isEnabled());
        const allTasks = HiddenTasksStore.filterVisible(
          (await Promise.allSettled(allProviders.map(p => p.getTasks())))
            .filter((r): r is PromiseFulfilledResult<KanbanTask[]> => r.status === 'fulfilled')
            .flatMap(r => r.value),
        );
        const doneTasks = allTasks.filter(t => t.status === doneColId);
        const today = new Date().toISOString().slice(0, 10);
        const lines = [
          `# Done Tasks Report`,
          ``,
          `**Date:** ${today}`,
          `**Total:** ${doneTasks.length} task${doneTasks.length === 1 ? '' : 's'}`,
          ``,
          `| # | Title | Provider | Labels | Assignee |`,
          `|---|-------|----------|--------|----------|`,
          ...doneTasks.map((t, i) => {
            const title = t.url ? `[${t.title}](${t.url})` : t.title;
            return `| ${i + 1} | ${title} | ${t.providerId} | ${t.labels.join(', ')} | ${t.assignee ?? '\u2014'} |`;
          }),
          ``,
        ];
        const md = lines.join('\n');
        await vscode.env.clipboard.writeText(md);
        vscode.window.showInformationMessage(`Copied ${doneTasks.length} done task(s) to clipboard as Markdown.`);
        break;
      }

      case 'startAgent':
        runCliAgent(panel, msg.taskId, msg.provider, msg.prompt, genAiRegistry);
        break;

      case 'cancelAgent':
        cancelCliAgent(msg.taskId);
        break;

      case 'cleanDone': {
        const configuredCols2 = buildColumnOrder(ProjectConfig.getProjectConfig()?.kanban?.intermediateColumns);
        const doneColId2 = configuredCols2[configuredCols2.length - 1] ?? 'done';
        const allProviders2 = providerRegistry.getAll().filter(p => p.isEnabled());
        const allTasks2 = (await Promise.allSettled(allProviders2.map(p => p.getTasks())))
          .filter((r): r is PromiseFulfilledResult<KanbanTask[]> => r.status === 'fulfilled')
          .flatMap(r => r.value);
        const doneTasks2 = allTasks2.filter(t => t.status === doneColId2);
        if (doneTasks2.length === 0) { break; }
        HiddenTasksStore.hideMany(doneTasks2.map(t => t.id));
        await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
        break;
      }

      case 'launchProvider':
        await squadManager.launchSingle(msg.taskId, msg.genAiProviderId, undefined, msg.baseBranch);
        panel.updateSquadStatus(squadManager.getStatus());
        await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
        break;

      case 'cancelSession':
        copilotLauncher.cancelSession(msg.taskId);
        squadManager.failSession(msg.taskId);
        panel.updateSquadStatus(squadManager.getStatus());
        await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
        break;

      case 'resetSession': {
        sessionStateManager.removeSession(msg.sessionId);
        const firstCol = buildColumnOrder(ProjectConfig.getProjectConfig()?.kanban?.intermediateColumns)[0];
        for (const prov of providerRegistry.getAll()) {
          const tasks = await prov.getTasks();
          const found = tasks.find(t => t.id === msg.sessionId);
          if (found) {
            await prov.updateTask({ ...found, status: firstCol });
            break;
          }
        }
        squadManager.failSession(msg.sessionId);
        panel.updateSquadStatus(squadManager.getStatus());
        await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
        break;
      }

      case 'reopenSession':
        await vscode.commands.executeCommand('workbench.action.chat.open');
        break;

      case 'openDiff': {
        const dw = copilotLauncher.getDiffWatcher(msg.sessionId);
        if (dw) {
          await dw.openDiff(msg.filePath);
        } else {
          const session = sessionStateManager.getSession(msg.sessionId);
          const wtPath = session?.worktreePath;
          const watchRoot = wtPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (watchRoot) {
            const baseRef = wtPath ? (session?.baseBranch || 'main') : 'HEAD';
            const absPath = path.join(watchRoot, msg.filePath);
            const headUri = gitRefUri(watchRoot, msg.filePath, baseRef);
            const workingUri = vscode.Uri.file(absPath);
            await vscode.commands.executeCommand('vscode.diff', headUri, workingUri, `${msg.filePath} (${baseRef} ↔ Working)`);
          }
        }
        break;
      }

      case 'openFullDiff': {
        const dw = copilotLauncher.getDiffWatcher(msg.sessionId);
        if (dw) {
          await dw.openFullDiff(dw.getChanges());
        } else {
          const fdSession = sessionStateManager.getSession(msg.sessionId);
          const wtPath = fdSession?.worktreePath;
          const watchRoot = wtPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (watchRoot) {
            const baseRef = wtPath ? (fdSession?.baseBranch || 'main') : 'HEAD';
            const tempDw = new DiffWatcher(watchRoot, baseRef);
            const files = await tempDw.refresh();
            if (files.length > 0) {
              await tempDw.openFullDiff(files);
            } else {
              await vscode.commands.executeCommand('workbench.view.scm');
            }
            tempDw.dispose();
          } else {
            await vscode.commands.executeCommand('workbench.view.scm');
          }
        }
        break;
      }

      case 'openTerminalInWorktree': {
        const dw = copilotLauncher.getDiffWatcher(msg.sessionId);
        const worktreeRoot = dw?.rootPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (worktreeRoot) {
          const terminal = vscode.window.createTerminal({
            name: `Worktree: ${msg.sessionId.split(':').slice(1).join(':') || msg.sessionId}`,
            cwd: worktreeRoot,
          });
          terminal.show();
        }
        break;
      }

      case 'exportLog': {
        const stream = copilotLauncher.getStreamRegistry().get(msg.sessionId);
        if (stream) {
          const doc = await vscode.workspace.openTextDocument({ content: stream.exportLog(), language: 'log' });
          await vscode.window.showTextDocument(doc);
        }
        break;
      }

      case 'requestStreamResume': {
        const stream = copilotLauncher.getStreamRegistry().get(msg.sessionId);
        if (stream) {
          panel.postMessage({ type: 'streamResume', sessionId: msg.sessionId, log: stream.exportLog() });
        } else {
          const persistedLog = copilotLauncher.readPersistedLog(msg.sessionId);
          if (persistedLog) {
            panel.postMessage({ type: 'streamResume', sessionId: msg.sessionId, log: persistedLog });
          }
        }
        break;
      }

      case 'requestFileChanges': {
        const existingDw = copilotLauncher.getDiffWatcher(msg.sessionId);
        if (existingDw) {
          const files = await existingDw.refresh();
          panel.updateFileChanges(msg.sessionId, files);
        } else {
          const fcSession = sessionStateManager.getSession(msg.sessionId);
          const wtPath = fcSession?.worktreePath;
          if (wtPath) {
            const baseRef = fcSession?.baseBranch || 'main';
            const tempDw = new DiffWatcher(wtPath, baseRef);
            const files = await tempDw.refresh();
            tempDw.dispose();
            panel.updateFileChanges(msg.sessionId, files);
          }
        }
        break;
      }

      case 'sendFollowUp':
        await copilotLauncher.sendFollowUp(msg.sessionId, msg.text);
        break;

      case 'openWorktree': {
        const wtUri = vscode.Uri.file(msg.worktreePath);
        await vscode.commands.executeCommand('vscode.openFolder', wtUri, { forceNewWindow: true });
        break;
      }

      case 'reviewWorktree': {
        const session = sessionStateManager.getSession(msg.sessionId);
        const wtPath = session?.worktreePath;
        const repoRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!wtPath || !repoRoot) { break; }
        if (!fs.existsSync(wtPath)) {
          vscode.window.showErrorMessage(`Worktree directory not found: ${wtPath}`);
          break;
        }

        try {
          const baseBr = session?.baseBranch || 'main';
          const branch = await execPromise('git rev-parse --abbrev-ref HEAD', { cwd: wtPath });
          const diffOutput = await execPromise(`git diff --name-status ${baseBr}...${branch.trim()}`, { cwd: repoRoot });
          const files = diffOutput.trim().split('\n').filter(l => l).map(line => {
            const [statusChar, ...pathParts] = line.split('\t');
            const filePath = pathParts.join('\t');
            return { statusChar, filePath };
          });
          const resources = files.map(f => {
            const absPath = path.join(repoRoot, f.filePath);
            const mainUri = vscode.Uri.file(absPath).with({
              scheme: 'git',
              query: JSON.stringify({ path: absPath, ref: baseBr }),
            });
            const branchUri = f.statusChar === 'D'
              ? vscode.Uri.file(absPath).with({ scheme: 'git', query: JSON.stringify({ path: absPath, ref: '' }) })
              : vscode.Uri.file(path.join(wtPath, f.filePath));
            return [vscode.Uri.file(absPath), mainUri, branchUri] as [vscode.Uri, vscode.Uri, vscode.Uri];
          });
          if (resources.length > 0) {
            await vscode.commands.executeCommand('vscode.changes', `Review: ${branch.trim()} vs ${baseBr}`, resources);
          } else {
            vscode.window.showInformationMessage(`Nessuna differenza tra il worktree e ${baseBr}.`);
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error('reviewWorktree failed:', errMsg);
          panel.postMessage({ type: 'mergeResult', sessionId: msg.sessionId, success: false, message: `Review failed: ${errMsg}` });
          vscode.window.showErrorMessage(`Review failed: ${errMsg}`);
        }
        break;
      }

      case 'mergeWorktree': {
        const session = sessionStateManager.getSession(msg.sessionId);
        const wtPath = session?.worktreePath;
        const repoRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!wtPath || !repoRoot) { break; }
        if (!fs.existsSync(wtPath)) {
          vscode.window.showErrorMessage(`Worktree directory not found: ${wtPath}`);
          break;
        }

        const strategy = msg.mergeStrategy ?? 'squash';
        const strategyLabels: Record<string, string> = {
          squash: 'Squash and merge',
          merge: 'Merge commit',
          rebase: 'Rebase and merge',
        };

        try {
          const baseBr = session?.baseBranch || 'main';
          const branch = (await execPromise('git rev-parse --abbrev-ref HEAD', { cwd: wtPath })).trim();

          const answer = await vscode.window.showWarningMessage(
            `${strategyLabels[strategy]} il branch "${branch}" in ${baseBr}?`,
            { modal: true },
            'Merge',
            'Annulla',
          );
          if (answer !== 'Merge') { break; }

          // Commit any uncommitted changes in the worktree first
          try {
            await execPromise('git add -A && git diff --cached --quiet || git commit -m "agent: auto-commit before merge"', { cwd: wtPath });
          } catch { /* ignore if nothing to commit */ }

          await execPromise(`git checkout ${baseBr}`, { cwd: repoRoot });

          if (strategy === 'squash') {
            await execPromise(`git merge --squash ${branch}`, { cwd: repoRoot });
            await execPromise(`git commit --no-edit -m "squash: ${branch}"`, { cwd: repoRoot });
          } else if (strategy === 'rebase') {
            await execPromise(`git rebase ${branch}`, { cwd: repoRoot });
          } else {
            await execPromise(`git merge ${branch} --no-edit`, { cwd: repoRoot });
          }

          panel.postMessage({ type: 'mergeResult', sessionId: msg.sessionId, success: true, message: `Branch "${branch}" mergiato in ${baseBr} (${strategyLabels[strategy]}).` });
          vscode.window.showInformationMessage(`✅ Branch "${branch}" mergiato in ${baseBr} (${strategyLabels[strategy]}).`);

          const mergeResolved = await providerRegistry.resolveTask(msg.sessionId);
          if (mergeResolved) {
            const { provider: mergeProvider, task: mergeTask } = mergeResolved;
            if (mergeTask) {
              const columnOrder = buildColumnOrder(ProjectConfig.getProjectConfig()?.kanban?.intermediateColumns);
              const currentIdx = columnOrder.indexOf(mergeTask.status);
              const nextCol = currentIdx >= 0 && currentIdx < columnOrder.length - 1
                ? columnOrder[currentIdx + 1]
                : columnOrder[columnOrder.length - 1];
              if (mergeTask.status !== nextCol) {
                await mergeProvider.updateTask({ ...mergeTask, status: nextCol });
              }
            }
          }

          sessionStateManager.markMerged(msg.sessionId);
          refresh();
          await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error('mergeWorktree failed:', errMsg);
          panel.postMessage({ type: 'mergeResult', sessionId: msg.sessionId, success: false, message: errMsg });
          vscode.window.showErrorMessage(`Merge fallito: ${errMsg}`);
        }
        break;
      }

      case 'alignWorktree': {
        const session = sessionStateManager.getSession(msg.sessionId);
        const wtPath = session?.worktreePath;
        const repoRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!wtPath || !repoRoot) {
          vscode.window.showErrorMessage('Align: worktree non trovato.');
          break;
        }

        const alignProviderId = session.providerId;
        const alignProvider = alignProviderId
          ? genAiRegistry?.get(alignProviderId) ?? genAiRegistry?.getAll().find(p => p.id !== 'chat')
          : genAiRegistry?.getAll().find(p => p.id !== 'chat');
        if (!alignProvider) {
          vscode.window.showErrorMessage('Align from main: nessun provider disponibile.');
          break;
        }

        try {
          const baseBr = session?.baseBranch || 'main';
          const branch = (await execPromise('git rev-parse --abbrev-ref HEAD', { cwd: wtPath })).trim();
          const behindCount = (await execPromise(`git rev-list --count ${branch}..${baseBr}`, { cwd: repoRoot })).trim();
          const baseDiff = (await execPromise(`git diff ${baseBr} --stat`, { cwd: wtPath })).trim();

          const alignPrompt =
            `## Align Worktree from ${baseBr}\n\n` +
            `You are working in the worktree at **${wtPath}** on branch **${branch}**.\n` +
            `The branch is **${behindCount}** commit(s) behind ${baseBr}.\n\n` +
            `### Current diff vs ${baseBr}\n\`\`\`\n${baseDiff}\n\`\`\`\n\n` +
            `### Instructions\n` +
            `1. From the worktree directory (${wtPath}), rebase or merge from ${baseBr} to align the branch:\n` +
            `   - Run: cd ${wtPath} && git fetch origin ${baseBr} && git rebase ${baseBr}\n` +
            `2. If there are merge conflicts, resolve them intelligently by understanding both sides\n` +
            `3. After resolving conflicts, ensure the code compiles and tests pass\n` +
            `4. Commit the resolution if needed\n` +
            `5. Report what changed and whether the alignment was successful\n`;

          await copilotLauncher.launch(msg.sessionId, alignProvider.id, undefined, alignPrompt);
          await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error('Align from base branch failed:', errMsg);
          vscode.window.showErrorMessage(`Align from ${session?.baseBranch || 'main'} fallito: ${errMsg}`);
        }
        break;
      }

      case 'agentMerge': {
        const session = sessionStateManager.getSession(msg.sessionId);
        const wtPath = session?.worktreePath;
        const repoRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!wtPath || !repoRoot) {
          vscode.window.showErrorMessage('Agent Merge: worktree non trovato.');
          break;
        }

        const strategy = msg.mergeStrategy ?? 'squash';
        const strategyLabels: Record<string, string> = {
          squash: 'squash and merge',
          merge: 'merge commit',
          rebase: 'rebase and merge',
        };

        const provider = msg.providerId
          ? genAiRegistry?.get(msg.providerId) ?? genAiRegistry?.getAll().find(p => p.id !== 'chat')
          : genAiRegistry?.getAll().find(p => p.id !== 'chat');
        if (!provider) {
          vscode.window.showErrorMessage('Merge by AI: nessun provider disponibile.');
          break;
        }

        try {
          const baseBr = session?.baseBranch || 'main';
          const branch = (await execPromise('git rev-parse --abbrev-ref HEAD', { cwd: wtPath })).trim();
          const diffSummary = (await execPromise(`git diff ${baseBr} --stat`, { cwd: wtPath })).trim();

          const mergePrompt =
            `## Merge Task\n\n` +
            `You are reviewing and merging branch "${branch}" into ${baseBr}.\n` +
            `Strategy: **${strategyLabels[strategy]}**.\n\n` +
            `### Changed files\n\`\`\`\n${diffSummary}\n\`\`\`\n\n` +
            `### Instructions\n` +
            `1. Review all changes in the worktree at ${wtPath}\n` +
            `2. Ensure code quality, check for bugs, security issues, and style\n` +
            `3. If changes are acceptable, perform the merge using the "${strategyLabels[strategy]}" strategy:\n` +
            (strategy === 'squash'
              ? `   - Run: git checkout ${baseBr} && git merge --squash ${branch} && git commit -m "squash: ${branch}"\n`
              : strategy === 'rebase'
                ? `   - Run: git checkout ${baseBr} && git rebase ${branch}\n`
                : `   - Run: git checkout ${baseBr} && git merge ${branch} --no-edit\n`) +
            `4. If changes need fixes, apply them first, then merge\n` +
            `5. Report what you found and whether the merge was successful\n`;

          await copilotLauncher.launch(msg.sessionId, provider.id, undefined, mergePrompt);
          await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error('Merge by AI failed:', errMsg);
          vscode.window.showErrorMessage(`Merge by AI fallito: ${errMsg}`);
        }
        break;
      }

      case 'deleteWorktree': {
        const session = sessionStateManager.getSession(msg.sessionId);
        const wtPath = session?.worktreePath;
        const repoRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!wtPath || !repoRoot) { break; }

        const answer = await vscode.window.showWarningMessage(
          `Eliminare il workspace worktree "${path.basename(wtPath)}"? Questa operazione è irreversibile.`,
          { modal: true },
          'Elimina',
          'Annulla',
        );
        if (answer !== 'Elimina') { break; }

        try {
          await removeWorktree(repoRoot, msg.sessionId);
          sessionStateManager.clearWorktree(msg.sessionId);
          panel.postMessage({ type: 'deleteWorktreeResult', sessionId: msg.sessionId, success: true });
          vscode.window.showInformationMessage('Worktree eliminato.');
          refresh();
          await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error('deleteWorktree failed:', errMsg);
          panel.postMessage({ type: 'deleteWorktreeResult', sessionId: msg.sessionId, success: false, message: errMsg });
          vscode.window.showErrorMessage(`Eliminazione fallita: ${errMsg}`);
        }
        break;
      }

      case 'createPullRequest': {
        const taskId = msg.sessionId;
        const allProviders = providerRegistry.getAll().filter(p => p.isEnabled());
        const allTasks = (await Promise.allSettled(allProviders.map(p => p.getTasks())))
          .filter((r): r is PromiseFulfilledResult<KanbanTask[]> => r.status === 'fulfilled')
          .flatMap(r => r.value);
        const task = allTasks.find(t => t.id === taskId);
        if (!task) { break; }

        const worktreeBranch = task.copilotSession?.changedFiles && task.copilotSession.changedFiles.length > 0
          ? `agent-board/${taskId.replace(/[^a-zA-Z0-9-]/g, '-')}`
          : undefined;
        if (!worktreeBranch) {
          panel.postMessage({ type: 'createPullRequestResult', sessionId: taskId, success: false, message: 'No changed files found.' });
          break;
        }

        const isAzure = await isAzureDevOpsRepository();
        const dw = copilotLauncher.getDiffWatcher(taskId);
        const changedFiles = dw?.getChanges() ?? [];
        const diffSummary = changedFiles.length > 0
          ? `### Files changed\n\n${changedFiles.map(f => `- \`${f.path}\``).join('\n')}`
          : '';
        const prSession = sessionStateManager.getSession(taskId);
        const pr = await prManager.createPR({
          title: task.title,
          body: `Closes #${task.nativeId}\n\n${diffSummary}`,
          headBranch: worktreeBranch,
          baseBranch: prSession?.baseBranch,
          isAzureDevOps: isAzure,
        });
        if (pr) {
          const prProvider = providerRegistry.get(task.providerId);
          if (prProvider) {
            const updatedTask = { ...task };
            if (updatedTask.copilotSession) {
              updatedTask.copilotSession = { ...updatedTask.copilotSession, prUrl: pr.url, prNumber: pr.number, prState: pr.state };
            }
            await prProvider.updateTask(updatedTask);
          }
          panel.postMessage({ type: 'createPullRequestResult', sessionId: taskId, success: true, prUrl: pr.url, prNumber: pr.number });
          await sendTasksToPanel(panel, providerRegistry, genAiRegistry, squadManager, sessionStateManager);
        } else {
          panel.postMessage({ type: 'createPullRequestResult', sessionId: taskId, success: false, message: 'PR creation cancelled or failed.' });
        }
        break;
      }
    }
  });
}
