import * as vscode from 'vscode';
import { ProjectConfig } from '../config/ProjectConfig';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
};

/**
 * Dedicated output-channel logger for the Task Kanban extension.
 * Log level is controlled by the `agentBoard.logLevel` setting
 * (default: `INFO` in production).
 */
export class Logger {
  private static instance: Logger | undefined;
  private readonly channel: vscode.OutputChannel;
  private level: LogLevel;

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

  dispose(): void {
    this.channel.dispose();
    Logger.instance = undefined;
  }

  // ── private ──────────────────────────────────────────────────────────────

  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (level < this.level) {
      return;
    }
    const timestamp = new Date().toISOString();
    const suffix = args.length > 0 ? ' ' + args.map(String).join(' ') : '';
    this.channel.appendLine(`[${timestamp}] [${LEVEL_LABELS[level]}] ${message}${suffix}`);
  }

  private readLevel(): LogLevel {
    const projectCfg = ProjectConfig.getProjectConfig();
    const raw = ProjectConfig.resolve(
      projectCfg?.logLevel,
      'logLevel',
      'INFO',
    ).toUpperCase();
    switch (raw) {
      case 'DEBUG': return LogLevel.DEBUG;
      case 'WARN': return LogLevel.WARN;
      case 'ERROR': return LogLevel.ERROR;
      default: return LogLevel.INFO;
    }
  }
}
