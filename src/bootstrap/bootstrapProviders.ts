import * as vscode from 'vscode';
import { GIT_REF_SCHEME, GitRefContentProvider } from '../diff/DiffWatcher';
import { AzureDevOpsProvider } from '../providers/AzureDevOpsProvider';
import { BeadsProvider } from '../providers/BeadsProvider';
import { GitHubProvider } from '../providers/GitHubProvider';
import { JsonProvider } from '../providers/JsonProvider';
import { MarkdownProvider } from '../providers/MarkdownProvider';
import { ProviderRegistry } from '../providers/ProviderRegistry';

export interface ProvidersBootstrapResult {
  providerRegistry: ProviderRegistry;
  githubProvider: GitHubProvider;
  jsonProvider: JsonProvider;
}

/**
 * Creates the ProviderRegistry and registers all task providers
 * (GitHub, JSON, Markdown, Azure DevOps, Beads) plus the GitRefContentProvider.
 */
export function bootstrapProviders(context: vscode.ExtensionContext): ProvidersBootstrapResult {
  const providerRegistry = new ProviderRegistry();

  // Register the content provider for agent-board-git: URIs (used by diff views)
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(GIT_REF_SCHEME, new GitRefContentProvider()),
  );

  // Register the GitHub provider (uses gh CLI)
  const githubProvider = new GitHubProvider(context);
  context.subscriptions.push(githubProvider);
  providerRegistry.register(githubProvider);

  // JSON-backed task provider — always registered, persists to .agent-board/tasks.json
  const jsonProvider = new JsonProvider();
  providerRegistry.register(jsonProvider);

  // Markdown-backed task provider — opt-in via .agent-board/config.json
  const markdownProvider = new MarkdownProvider();
  providerRegistry.register(markdownProvider);

  // Azure DevOps task provider — opt-in via .agent-board/config.json
  const azureDevOpsProvider = new AzureDevOpsProvider();
  providerRegistry.register(azureDevOpsProvider);

  // Beads task provider — opt-in via .agent-board/config.json
  const beadsProvider = new BeadsProvider();
  providerRegistry.register(beadsProvider);

  return { providerRegistry, githubProvider, jsonProvider };
}
