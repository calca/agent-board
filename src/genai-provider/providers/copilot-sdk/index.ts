/**
 * Barrel export for the copilot-sdk module.
 */
export type { CopilotEvent, CopilotEventHandler, UIBlock, ChatMessage } from './types';
export { mapEventToBlock } from './eventMapper';
export { mapSdkEvent, type RawSdkEvent } from './sdkEventMapper';
export { createChatBridge, type ChatBridgeMessage } from './ChatBridge';
