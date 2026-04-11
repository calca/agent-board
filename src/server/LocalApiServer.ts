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

import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
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

export class LocalApiServer {
  private readonly logger = Logger.getInstance();
  private server?: http.Server;
  private port: number = 3333;
  private distPath: string;
  private readonly connectedDevices = new Map<string, MobileDeviceInfo>();

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly extensionUri: string,
  ) {
    // Path to built webview assets
    this.distPath = path.join(extensionUri, 'dist');
  }

  /**
   * Start the HTTP server on the specified port.
   */
  start(port: number = 3333): void {
    if (this.server) {
      return;
    }
    this.port = port;
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const requestUrl = new URL(req.url ?? '/', `http://localhost:${this.port}`);
      const pathname = requestUrl.pathname;

      // Root — serve WebView HTML
      if (pathname === '/' && req.method === 'GET') {
        await this.handleGetRoot(res);
        return;
      }

      // Static assets
      if (pathname.startsWith('/assets/') && req.method === 'GET') {
        await this.handleGetAsset(pathname, res);
        return;
      }

      // API Routes
      if ((pathname === '/tasks' || pathname === '/api/tasks') && req.method === 'GET') {
        await this.handleGetTasks(res);
        return;
      }

      if ((pathname === '/tasks' || pathname === '/api/tasks') && req.method === 'POST') {
        await this.handlePostTask(req, res);
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

  private async handleGetRoot(res: http.ServerResponse): Promise<void> {
    // Read webview.html from dist/ (if it exists), otherwise serve a minimal HTML
    const htmlPath = path.join(this.distPath, 'webview.html');
    const jsPath = path.join(this.distPath, 'webview.js');
    const cssPath = path.join(this.distPath, 'webview.css');

    const hasWebviewHtml = fs.existsSync(htmlPath);
    const hasWebviewJs = fs.existsSync(jsPath);
    const hasCss = fs.existsSync(cssPath);

    if (hasWebviewHtml) {
      // Use pre-built HTML
      const html = fs.readFileSync(htmlPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } else {
      // Generate minimal HTML (fallback)
      const html = this.generateMinimalHtml(hasWebviewJs, hasCss);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    }
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
                 script-src 'self';
                 connect-src 'self';
                 font-src 'self' https:;
                 img-src 'self' https:;">
  ${hasCss ? '<link rel="stylesheet" href="/assets/webview.css">' : ''}
  <title>Agent Board - Mobile</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px; }
    .loader { text-align: center; }
    .loader__spinner { display: inline-block; width: 40px; height: 40px; border: 4px solid #ddd; border-top-color: #0078d4; border-radius: 50%; animation: spin 0.6s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
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

      // Convert KanbanTask to simplified Task format for mobile
      const simplifiedTasks = allTasks.map(t => ({
        id: t.id,
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
      const status = typeof body.status === 'string' ? body.status : undefined;

      if (!status) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required field: status' }));
        return;
      }

      // Extract providerId from taskId (format: providerId:nativeId)
      const [providerId] = taskId.split(':');
      const provider = this.registry.get(providerId);

      if (!provider) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Provider not found: ${providerId}` }));
        return;
      }

      // Get the task
      const tasks = await provider.getTasks();
      const task = tasks.find(t => t.id === taskId);

      if (!task) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Task not found' }));
        return;
      }

      // Update task status
      await provider.updateTask({
        ...task,
        status: status as ColumnId,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, taskId, status }));
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
    this.connectedDevices.set(ip, entry);
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
