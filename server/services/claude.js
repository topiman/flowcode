// Re-export pool management
export { isRunning, isAlive, cancelRun, killProcess, sendMessage, sendCommand, getOrCreateProcess, getProcessInfo, getSessionId, shutdown, autoModeRunning } from './claude-process.js';

// Re-export workflow execution
export { executeStep, advanceStep, retryStep, runAutoMode, sendMessage_workflow as sendWorkflowMessage } from './workflow-executor.js';

// Re-export conversation
export { sendConversationMessage } from './conversation.js';

// Re-export prompt building
export { buildAgentPrompt } from './prompt-builder.js';
