import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ProjectConfig } from '../config/ProjectConfig';

export enum LogLevel {
  TRACE = 0,
  DEBUG = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.TRACE]: 'TRACE',
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
};

/**
 * Dedicated output-channel logger for the Task Kanban extension.
 *
 * Logs are written to:
 *   1. The VS Code Output channel ("Task Kanban").
 *   2. A daily log file under `.agent-board/logs/agent-board-YYYY-MM-DD.log`.
 *
 * Log level is controlled by `agentBoard.logLevel` / project config
 * (default: `INFO`).  Old log files are cleaned up based on
 * `logging.retentionDays` (default 7).
 */
export class Logger {
  private static instance: Logger | undefined;
  private readonly channel: vscode.OutputChannel;
  private level: LogLevel;

  /** Currently open log file date tag (`YYYY-MM-DD`). */
  private currentDateTag = '';
  /** Absolute path of the currently open log file. */
  private currentLogPath = '';
  /** Write stream for the current log file (undefined until the first write). */
  private fileStream: fs.WriteStream | undefined;

  private constructor() {
    this.channel = vscode.window.createOutputChannel('Task Kanban');
    this.level = this.readLevel();
  }

  /** Singleton accessor. */
  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /** Re-read the configured log level (call after settings change). */
  refreshLevel(): void {
    this.level = this.readLevel();
  }

  trace(message: string, ...args: unknown[]): void {
    this.log(LogLevel.TRACE, message, ...args);
  }

  debug(message: string, ...args: unknown[]): void {
    this.log(LogLevel.DEBUG, message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.log(LogLevel.INFO, message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log(LogLevel.WARN, message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.log(LogLevel.ERROR, message, ...args);
  }

  /** Show the Output channel in the UI. */
  show(): void {
    this.channel.show(true);
  }

  /** Return the current effective log level. */
  getLevel(): LogLevel {
    return this.level;
  }

  /**
   * Read recent log content (current day by default).
   * Returns up to `maxLines` most-recent lines.
   */
  readLogContent(maxLines = 500): string {
    const logDir = Logger.logDir();
    if (!logDir) { return ''; }
    const dateTag = Logger.dateTag();
    const filePath = path.join(logDir, `agent-board-${dateTag}.log`);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      if (lines.length > maxLines) {
        return lines.slice(-maxLines).join('\n');
      }
      return content;
    } catch {
      return '';
    }
  }

  /**
   * List available log files (most recent first).
   */
  listLogFiles(): string[] {
    const logDir = Logger.logDir();
    if (!logDir || !fs.existsSync(logDir)) { return []; }
    return fs.readdirSync(logDir)
      .filter(f => f.startsWith('agent-board-') && f.endsWith('.log'))
      .sort()
      .reverse();
  }

  /**
   * Read content of a specific log file by name.
   */
  readLogFile(fileName: string, maxLines = 2000): string {
    const logDir = Logger.logDir();
    if (!logDir) { return ''; }
    // Prevent path traversal
    const safe = path.basename(fileName);
    const filePath = path.join(logDir, safe);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      if (lines.length > maxLines) {
        return lines.slice(-maxLines).join('\n');
      }
      return content;
    } catch {
      return '';
    }
  }

  dispose(): void {
    this.closeStream();
    this.channel.dispose();
    Logger.instance = undefined;
  }

  // ── private ──────────────────────────────────────────────────────────────

  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (level < this.level) {
      return;
    }
    const timestamp = new Date().toISOString();
    const formatted = Logger.formatMessage(message, args);
    const line = `[${timestamp}] [${LEVEL_LABELS[level]}] ${formatted}`;
    this.channel.appendLine(line);
    this.writeToFile(line);
  }

  /**
   * Replace printf-style placeholders (`%s`, `%d`, `%j`, `%o`, `%%`)
   * with the corresponding arguments.  Extra args are appended.
   */
  private static formatMessage(message: string, args: unknown[]): string {
    if (args.length === 0) { return message; }
    let i = 0;
    const result = message.replace(/%([sdjo%])/g, (match, specifier: string) => {
      if (specifier === '%') { return '%'; }
      if (i >= args.length) { return match; }
      const arg = args[i++];
      switch (specifier) {
        case 'd': return String(Number(arg));
        case 'j':
        case 'o':
          try { return JSON.stringify(arg); } catch { return String(arg); }
        default: return String(arg);
      }
    });
    // Append any leftover args that weren't consumed by placeholders
    if (i < args.length) {
      return result + ' ' + args.slice(i).map(String).join(' ');
    }
    return result;
  }

  /** Write a line to the daily log file. */
  private writeToFile(line: string): void {
    const logDir = Logger.logDir();
    if (!logDir) { return; }

    const dateTag = Logger.dateTag();

    // Rotate if the day has changed
    if (dateTag !== this.currentDateTag) {
      this.closeStream();
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      this.currentDateTag = dateTag;
      this.currentLogPath = path.join(logDir, `agent-board-${dateTag}.log`);
      this.fileStream = fs.createWriteStream(this.currentLogPath, { flags: 'a' });
      this.cleanOldLogs(logDir);
    }

    this.fileStream?.write(line + '\n');
  }

  /** Remove log files older than `retentionDays`. */
  private cleanOldLogs(logDir: string): void {
    const projectCfg = ProjectConfig.getProjectConfig();
    const retentionDays = projectCfg?.logging?.retentionDays ?? 7;
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    try {
      for (const file of fs.readdirSync(logDir)) {
        if (!file.startsWith('agent-board-') || !file.endsWith('.log')) { continue; }
        const dateStr = file.replace('agent-board-', '').replace('.log', '');
        const fileDate = new Date(dateStr + 'T00:00:00Z').getTime();
        if (!isNaN(fileDate) && fileDate < cutoff) {
          fs.unlinkSync(path.join(logDir, file));
        }
      }
    } catch {
      // Best-effort cleanup
    }
  }

  private closeStream(): void {
    if (this.fileStream) {
      this.fileStream.end();
      this.fileStream = undefined;
    }
  }

  private readLevel(): LogLevel {
    const projectCfg = ProjectConfig.getProjectConfig();
    const raw = ProjectConfig.resolve(
      projectCfg?.logLevel,
      'logLevel',
      'INFO',
    ).toUpperCase();
    switch (raw) {
      case 'TRACE': return LogLevel.TRACE;
      case 'DEBUG': return LogLevel.DEBUG;
      case 'WARN': return LogLevel.WARN;
      case 'ERROR': return LogLevel.ERROR;
      default: return LogLevel.INFO;
    }
  }

  /** Absolute path to `.agent-board/logs` in the first workspace folder. */
  private static logDir(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { return undefined; }
    return path.join(folders[0].uri.fsPath, '.agent-board', 'logs');
  }

  /** Current date as `YYYY-MM-DD`. */
  private static dateTag(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}
