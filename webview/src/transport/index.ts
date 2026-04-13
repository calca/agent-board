/**
 * Transport factory — returns the appropriate ITransport
 * based on the runtime environment.
 */

import { HttpTransport } from './HttpTransport';
import type { ITransport } from './ITransport';
import { VsCodeTransport } from './VsCodeTransport';

export type { ITransport, PushHandler } from './ITransport';

export const transport: ITransport =
  typeof (globalThis as any).acquireVsCodeApi !== 'undefined'
    ? new VsCodeTransport()
    : new HttpTransport();
