/**
 * LocalApiServer.ts — HTTP server for mobile companion.
 *
 * Exposes task management via REST API on localhost:3333 to allow
 * mobile browser access on the same WiFi network.
 *
 * Endpoints:
 * - GET    /                → serve WebView entry point HTML
 * - GET    /api/tasks       → list all tasks
 * - PATCH  /api/tasks/:id  → update task status
 * - POST   /api/tasks       → create new task
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { HiddenTasksStore } from '../config/HiddenTasksStore';
import { JsonProvider } from '../providers/JsonProvider';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import type { ColumnId } from '../types/ColumnId';
import type { KanbanTask } from '../types/KanbanTask';
import { Logger } from '../utils/logger';

export interface MobileDeviceInfo {
  ip: string;
  lastAccess: string;
  userAgent?: string;
}

export interface MobileStatusSnapshot {
  squadStatus: { activeCount: number; maxSessions: number; autoSquadEnabled: boolean };
  providers: { id: string; displayName: string; disabled?: boolean }[];
  agents: { slug: string; displayName: string; canSquad?: boolean }[];
  columns: { id: string; label: string; color?: string }[];
  repoIsGit: boolean;
  repoIsGitHub: boolean;
}

export class LocalApiServer {
  private readonly logger = Logger.getInstance();
  private server?: http.Server;
  private port: number = 3333;
  private distPath: string;
  private readonly connectedDevices = new Map<string, MobileDeviceInfo>();
  private statusProvider?: () => MobileStatusSnapshot;
  private squadActionHandler?: (action: 'startSquad' | 'toggleAutoSquad', agentSlug?: string, genAiProviderId?: string) => Promise<void>;
  private refreshHandler?: () => Promise<void>;
  private sessionToken: string = '';
  private deviceChangeHandler?: () => void;

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly extensionUri: string,
    private readonly workspaceName: string = '',
  ) {
    // Path to built webview assets
    this.distPath = path.join(extensionUri, 'dist');
  }

  /** Register a callback that returns the live status snapshot. */
  setStatusProvider(fn: () => MobileStatusSnapshot): void {
    this.statusProvider = fn;
  }

  /** Register a handler for squad actions from mobile. */
  setSquadActionHandler(fn: (action: 'startSquad' | 'toggleAutoSquad', agentSlug?: string, genAiProviderId?: string) => Promise<void>): void {
    this.squadActionHandler = fn;
  }

  /** Register a handler for refresh/sync requests from mobile. */
  setRefreshHandler(fn: () => Promise<void>): void {
    this.refreshHandler = fn;
  }

  /** Register a callback invoked when the connected device list changes. */
  onDeviceChange(fn: () => void): void {
    this.deviceChangeHandler = fn;
  }

  /**
   * Start the HTTP server on the specified port.
   */
  /** Get the session OTP token (generated on each start). */
  getSessionToken(): string {
    return this.sessionToken;
  }

  start(port: number = 3333): void {
    if (this.server) {
      return;
    }
    this.port = port;
    this.sessionToken = crypto.randomUUID();
    this.server = http.createServer((req, res) => this.handleRequest(req, res));

    this.server.listen(port, '0.0.0.0', () => {
      this.logger.info(`LocalApiServer listening on http://0.0.0.0:${port}`);
    });

    this.server.on('error', (error) => {
      this.logger.error(`LocalApiServer error: ${error.message}`);
    });
  }

  /**
   * Stop the HTTP server.
   */
  stop(): void {
    if (this.server) {
      this.server.close(() => {
        this.logger.info('LocalApiServer stopped');
      });
      this.server = undefined;
      this.connectedDevices.clear();
      this.sessionToken = '';
    }
  }

  /**
   * Check if server is running.
   */
  isRunning(): boolean {
    return this.server !== undefined;
  }

  getPort(): number {
    return this.port;
  }

  getConnectedDevices(): MobileDeviceInfo[] {
    return [...this.connectedDevices.values()].sort((a, b) => b.lastAccess.localeCompare(a.lastAccess));
  }

  // ── Request handling ────────────────────────────────────────────────

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    this.trackDevice(req);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Board-Token');

    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const requestUrl = new URL(req.url ?? '/', `http://localhost:${this.port}`);
      const pathname = requestUrl.pathname;

      // Root — serve WebView HTML (token required in query string)
      if (pathname === '/' && req.method === 'GET') {
        if (!this.validateSessionTokenFromQuery(requestUrl, res)) {
          return;
        }
        await this.handleGetRoot(res);
        return;
      }

      // Static assets (no token needed — assets are inert without the token)
      if (pathname.startsWith('/assets/') && req.method === 'GET') {
        await this.handleGetAsset(pathname, res);
        return;
      }

      // ── OTP token check for all API routes ──────────────────────────
      if (!this.validateSessionToken(req, res)) {
        return;
      }

      // API Routes
      if ((pathname === '/info' || pathname === '/api/info') && req.method === 'GET') {
        this.handleGetInfo(res);
        return;
      }

      if ((pathname === '/tasks' || pathname === '/api/tasks') && req.method === 'GET') {
        await this.handleGetTasks(res);
        return;
      }

      if ((pathname === '/tasks' || pathname === '/api/tasks') && req.method === 'POST') {
        await this.handlePostTask(req, res);
        return;
      }

      // Squad actions
      if ((pathname === '/squad/start' || pathname === '/api/squad/start') && req.method === 'POST') {
        await this.handleSquadAction('startSquad', req, res);
        return;
      }

      if ((pathname === '/squad/toggle-auto' || pathname === '/api/squad/toggle-auto') && req.method === 'POST') {
        await this.handleSquadAction('toggleAutoSquad', req, res);
        return;
      }

      if ((pathname === '/sync' || pathname === '/api/sync') && req.method === 'POST') {
        await this.handleSync(res);
        return;
      }

      if ((pathname.startsWith('/tasks/') || pathname.startsWith('/api/tasks/')) && req.method === 'PATCH') {
        const taskId = pathname.startsWith('/tasks/')
          ? pathname.substring('/tasks/'.length)
          : pathname.substring('/api/tasks/'.length);
        await this.handlePatchTask(taskId, req, res);
        return;
      }

      // 404
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (error) {
      this.logger.error(`Error handling request: ${error}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  // ── Handler: GET / ──────────────────────────────────────────────────

  /**
   * Validate the X-Board-Token header against the current session token.
   * Returns true if valid, false (and sends 401) if invalid.
   */
  private validateSessionToken(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    if (!this.sessionToken) {
      return true; // No token generated yet (should not happen)
    }
    const headerToken = req.headers['x-board-token'];
    const token = Array.isArray(headerToken) ? headerToken[0] : headerToken;
    if (token === this.sessionToken) {
      return true;
    }
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized — invalid or missing session token' }));
    return false;
  }

  /**
   * Validate the `token` query-string parameter.
   * Used for `GET /` so the HTML page itself is protected.
   */
  private validateSessionTokenFromQuery(requestUrl: URL, res: http.ServerResponse): boolean {
    if (!this.sessionToken) {
      return true;
    }
    const token = requestUrl.searchParams.get('token');
    if (token === this.sessionToken) {
      return true;
    }
    res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(this.generate401Html());
    return false;
  }

  private generate401Html(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agent Board — Access Denied</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1e1e1e;
      color: #cccccc;
    }
    .card {
      text-align: center;
      max-width: 420px;
      padding: 48px 32px;
      border: 1px solid #3c3c3c;
      border-radius: 16px;
      background: #252526;
    }
    .icon {
      font-size: 56px;
      margin-bottom: 16px;
      opacity: 0.8;
    }
    h1 {
      font-size: 1.4rem;
      font-weight: 700;
      margin-bottom: 12px;
      color: #f48771;
    }
    p {
      line-height: 1.6;
      opacity: 0.85;
      margin-bottom: 8px;
    }
    .hint {
      margin-top: 24px;
      padding: 12px 16px;
      border-radius: 8px;
      background: #1a1a2e;
      border: 1px solid #3c3c3c;
      font-size: 0.85rem;
      opacity: 0.7;
    }
    .hint code {
      font-family: 'SF Mono', Menlo, Monaco, 'Courier New', monospace;
      background: #333;
      padding: 2px 6px;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">\uD83D\uDD12</div>
    <h1>Access Denied</h1>
    <p>This session token is missing or no longer valid.</p>
    <p>Each time the server starts, a new token is generated.</p>
    <div class="hint">
      Scan the QR code from <code>Agent Board Mobile</code> in VS Code to get a fresh link.
    </div>
  </div>
</body>
</html>`;
  }

  private async handleGetRoot(res: http.ServerResponse): Promise<void> {
    // Read webview.html from dist/ (if it exists), otherwise serve a minimal HTML
    const htmlPath = path.join(this.distPath, 'webview.html');
    const jsPath = path.join(this.distPath, 'webview.js');
    const cssPath = path.join(this.distPath, 'webview.css');

    const hasWebviewHtml = fs.existsSync(htmlPath);
    const hasWebviewJs = fs.existsSync(jsPath);
    const hasCss = fs.existsSync(cssPath);

    if (hasWebviewHtml) {
      // Use pre-built HTML — inject session token
      let html = fs.readFileSync(htmlPath, 'utf-8');
      html = this.injectSessionToken(html);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } else {
      // Generate minimal HTML (fallback)
      const html = this.generateMinimalHtml(hasWebviewJs, hasCss);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    }
  }

  /**
   * Inject a small inline script that exposes the session token
   * so the client-side JS can read it and send it as a header.
   */
  private injectSessionToken(html: string): string {
    const script = `<script>window.__BOARD_SESSION_TOKEN=${JSON.stringify(this.sessionToken)};<\/script>`;
    // Insert right before </head> if present, otherwise before </body>
    if (html.includes('</head>')) {
      return html.replace('</head>', `${script}\n</head>`);
    }
    if (html.includes('</body>')) {
      return html.replace('</body>', `${script}\n</body>`);
    }
    return script + html;
  }

  private generateMinimalHtml(hasJs: boolean, hasCss: boolean): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 style-src 'self' 'unsafe-inline' https:;
                 script-src 'self' 'unsafe-inline';
                 connect-src 'self';
                 font-src 'self' https:;
                 img-src 'self' https:;">
  <style>
    /* VS Code variable fallbacks — dark theme for mobile browsers */
    :root {
      --vscode-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --vscode-font-size: 13px;
      --vscode-foreground: #cccccc;
      --vscode-descriptionForeground: #888;
      --vscode-editor-background: #1e1e1e;
      --vscode-editor-foreground: #cccccc;
      --vscode-editor-font-family: 'SF Mono', Menlo, Monaco, 'Courier New', monospace;
      --vscode-sideBar-background: #252526;
      --vscode-panel-border: #3c3c3c;
      --vscode-focusBorder: #007fd4;
      --vscode-input-background: #3c3c3c;
      --vscode-input-foreground: #cccccc;
      --vscode-input-border: #3c3c3c;
      --vscode-input-placeholderForeground: #888;
      --vscode-button-background: #0e639c;
      --vscode-button-foreground: #ffffff;
      --vscode-button-hoverBackground: #1177bb;
      --vscode-button-secondaryBackground: #3a3d41;
      --vscode-button-secondaryForeground: #cccccc;
      --vscode-button-secondaryHoverBackground: #4a4d51;
      --vscode-toolbar-hoverBackground: rgba(90, 93, 94, 0.31);
      --vscode-badge-background: #4d4d4d;
      --vscode-badge-foreground: #ffffff;
      --vscode-dropdown-background: #3c3c3c;
      --vscode-dropdown-foreground: #cccccc;
      --vscode-dropdown-border: #3c3c3c;
      --vscode-progressBar-background: #0e70c0;
      --vscode-errorForeground: #f48771;
      --vscode-terminal-ansiRed: #f44747;
      --vscode-terminal-ansiGreen: #16825d;
      --vscode-terminal-ansiYellow: #d9a500;
      --vscode-terminal-ansiCyan: #11a8cd;
      --vscode-charts-orange: #d18616;
      --vscode-textLink-foreground: #3794ff;
    }
  </style>
  ${hasCss ? '<link rel="stylesheet" href="/assets/webview.css">' : ''}
  <title>Agent Board - Mobile</title>
  <script>window.__BOARD_SESSION_TOKEN=${JSON.stringify(this.sessionToken)};<\/script>
</head>
<body>
  <div id="root"></div>
  ${hasJs ? '<script src="/assets/webview.js"><\/script>' : '<p>WebView assets not found. Please build the extension.</p>'}
</body>
</html>`;
  }

  // ── Handler: GET /assets/* ──────────────────────────────────────────

  private async handleGetAsset(pathname: string, res: http.ServerResponse): Promise<void> {
    // Extract asset name (e.g. /assets/webview.css → webview.css)
    const assetName = pathname.substring('/assets/'.length);

    // Prevent directory traversal attacks
    if (assetName.includes('..') || assetName.includes('/')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden' }));
      return;
    }

    const filePath = path.join(this.distPath, assetName);

    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    const mimeType = this.getMimeType(filePath);
    const fileContent = fs.readFileSync(filePath);

    res.writeHead(200, { 'Content-Type': mimeType });
    res.end(fileContent);
  }

  // ── Handler: GET /api/tasks ────────────────────────────────────────

  // ── Handler: GET /api/info ─────────────────────────────────────────

  private async handleSquadAction(action: 'startSquad' | 'toggleAutoSquad', req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.squadActionHandler) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Squad handler not available' }));
      return;
    }
    try {
      const body = await this.readJsonBody(req);
      const agentSlug = body?.agentSlug as string | undefined;
      const genAiProviderId = body?.genAiProviderId as string | undefined;
      await this.squadActionHandler(action, agentSlug, genAiProviderId);
      const status = this.statusProvider?.();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, squadStatus: status?.squadStatus }));
    } catch (error) {
      this.logger.error(`Squad action error: ${error}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  }

  private handleGetInfo(res: http.ServerResponse): void {
    const status = this.statusProvider?.();
    const payload = {
      workspaceName: this.workspaceName,
      ...(status ? {
        squadStatus: status.squadStatus,
        providers: status.providers,
        agents: status.agents,
        columns: status.columns,
        repoIsGit: status.repoIsGit,
        repoIsGitHub: status.repoIsGitHub,
      } : {}),
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  }

  private async handleSync(res: http.ServerResponse): Promise<void> {
    if (!this.refreshHandler) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Refresh handler not available' }));
      return;
    }
    try {
      await this.refreshHandler();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (error) {
      this.logger.error(`Sync error: ${error}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  }

  private async handleGetTasks(res: http.ServerResponse): Promise<void> {
    try {
      const allTasks: KanbanTask[] = [];

      // Fetch tasks from all enabled providers
      for (const provider of this.registry.getAll()) {
        if (provider.isEnabled()) {
          const tasks = await provider.getTasks();
          allTasks.push(...tasks);
        }
      }

      // Filter hidden tasks (same filter used by the VS Code webview)
      const visibleTasks = HiddenTasksStore.filterVisible(allTasks);

      // Convert KanbanTask to simplified Task format for mobile
      const simplifiedTasks = visibleTasks.map(t => ({
        id: t.id,
        nativeId: t.nativeId,
        title: t.title,
        body: t.body,
        status: t.status,
        labels: t.labels,
        assignee: t.assignee,
        url: t.url,
        providerId: t.providerId,
        createdAt: t.createdAt?.toISOString?.() ?? undefined,
        agent: t.agent,
        meta: t.meta,
        copilotSession: t.copilotSession ? {
          state: t.copilotSession.state,
          providerId: t.copilotSession.providerId,
          startedAt: t.copilotSession.startedAt,
          finishedAt: t.copilotSession.finishedAt,
          prUrl: t.copilotSession.prUrl,
          prNumber: t.copilotSession.prNumber,
          prState: t.copilotSession.prState,
          changedFiles: t.copilotSession.changedFiles,
          worktreePath: t.copilotSession.worktreePath,
          errorMessage: t.copilotSession.errorMessage,
          merged: t.copilotSession.merged,
        } : undefined,
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(simplifiedTasks));
    } catch (error) {
      this.logger.error(`Error fetching tasks: ${error}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch tasks' }));
    }
  }

  // ── Handler: POST /api/tasks ───────────────────────────────────────

  private async handlePostTask(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readJsonBody(req);
    if (!body) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    try {
      const title = typeof body.title === 'string' ? body.title : '';
      const description = typeof body.body === 'string' ? body.body : undefined;
      const providerId = typeof body.providerId === 'string' ? body.providerId : undefined;
      const targetProviderId = providerId && providerId.trim() ? providerId : 'json';

      if (!title) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required field: title' }));
        return;
      }

      const provider = this.registry.get(targetProviderId);
      if (!provider) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Provider not found: ${targetProviderId}` }));
        return;
      }

      if (provider.id !== 'json') {
        res.writeHead(501, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Create task via HTTP is currently supported only for json provider' }));
        return;
      }

      const created = await (provider as JsonProvider).createTask(String(title), typeof description === 'string' ? description : undefined);

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: created.id,
        title: created.title,
        body: created.body,
        status: created.status,
        labels: created.labels,
        assignee: created.assignee,
        url: created.url,
        providerId: created.providerId,
        createdAt: created.createdAt?.toISOString?.() ?? undefined,
        agent: created.agent,
        meta: created.meta,
      }));
    } catch (error) {
      this.logger.error(`Error creating task: ${error}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to create task' }));
    }
  }

  // ── Handler: PATCH /api/tasks/:id ──────────────────────────────────

  private async handlePatchTask(taskId: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readJsonBody(req);
    if (!body) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    try {
      // Resolve provider and task from composite id
      const resolved = await this.registry.resolveTask(taskId);

      if (!resolved) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Task not found: ${taskId}` }));
        return;
      }

      const { provider, task } = resolved;

      // Apply all provided fields
      const updated = { ...task };
      if (typeof body.status === 'string') { updated.status = body.status as ColumnId; }
      if (typeof body.title === 'string') { updated.title = body.title; }
      if (typeof body.body === 'string') { updated.body = body.body; }
      if (typeof body.assignee === 'string') { updated.assignee = body.assignee || undefined; }
      if (typeof body.labels === 'string') {
        updated.labels = body.labels.split(',').map((l: string) => l.trim()).filter(Boolean);
      } else if (Array.isArray(body.labels)) {
        updated.labels = body.labels;
      }

      await provider.updateTask(updated);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, taskId }));
    } catch (error) {
      this.logger.error(`Error updating task: ${error}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to update task' }));
    }
  }

  // ── Utilities ───────────────────────────────────────────────────────

  private async readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown> | null> {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk.toString();
      });
      req.on('end', () => {
        if (!data) {
          resolve(null);
          return;
        }

        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
      req.on('error', reject);

      // Timeout after 5 seconds
      setTimeout(() => {
        resolve(null);
      }, 5000);
    });
  }

  private trackDevice(req: http.IncomingMessage): void {
    const rawIp = req.socket.remoteAddress || 'unknown';
    const ip = rawIp.startsWith('::ffff:') ? rawIp.slice(7) : rawIp;
    if (ip === '127.0.0.1' || ip === '::1' || ip === 'unknown') {
      return;
    }
    const entry: MobileDeviceInfo = {
      ip,
      lastAccess: new Date().toISOString(),
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    };
    const isNew = !this.connectedDevices.has(ip);
    this.connectedDevices.set(ip, entry);
    if (isNew && this.deviceChangeHandler) {
      this.deviceChangeHandler();
    }
  }

  private getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.html': 'text/html',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.gif': 'image/gif',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
    };
    return mimeTypes[ext] ?? 'application/octet-stream';
  }
}
