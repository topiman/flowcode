import { existsSync } from 'fs';
import { join } from 'path';
import db from '../db.js';
import { broadcast } from './sse.js';
import { PROJECTS_DIR } from '../config.js';
import { sendMessage, killProcess, autoModeRunning } from './claude-process.js';
import { buildAgentPrompt, buildHistorySummary } from './prompt-builder.js';

// ─── Server-side step execution: run a specific agent step ───
export async function executeStep(workflowId, userMessage = '开始执行') {
  const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId);
  if (!wf) throw new Error('Workflow not found');

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(wf.project_id);
  const cwd = wf.worktree_dir || join(PROJECTS_DIR, project.name);
  const step = db.prepare('SELECT * FROM workflow_steps WHERE workflow_id = ? AND step_name = ?').get(workflowId, wf.current_step);
  if (!step) throw new Error('Step not found: ' + wf.current_step);

  const agent = db.prepare('SELECT * FROM agents WHERE name = ?').get(step.step_name);
  if (!agent) throw new Error('Agent not found: ' + step.step_name);

  // Update step status
  db.prepare("UPDATE workflow_steps SET status = 'in-progress', started_at = datetime('now') WHERE id = ?").run(step.id);
  db.prepare("UPDATE workflows SET current_step = ?, updated_at = datetime('now') WHERE id = ?").run(step.step_name, workflowId);
  broadcast(workflowId, 'state', { currentStep: step.step_name, status: 'in-progress', steps: { [step.step_name]: { status: 'in-progress' } } });

  // Save user message
  const convId = wf.conversation_id;
  db.prepare('INSERT INTO chat_messages (workflow_id, conversation_id, role, content) VALUES (?, ?, ?, ?)').run(workflowId, convId || null, 'user', userMessage);
  broadcast(workflowId, 'chat-message', { role: 'user', content: userMessage });

  // Build agent prompt with skills
  const agentPrompt = buildAgentPrompt(agent, cwd);

  // Whitelist: only allow tools the agent needs (no Agent/SendMessage/ToolSearch)
  const allowedTools = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];

  let result;
  if (step.session_id) {
    // Resume: persistent process or new process with --resume
    console.log(`[executeStep] resuming step session ${step.session_id.slice(0, 8)} for ${step.step_name}`);
    try {
      result = await sendMessage(workflowId, userMessage, {
        cwd,
        sessionId: step.session_id,
        broadcastKey: workflowId,
        allowedTools,
        model: agent.model || undefined,
      });
    } catch (err) {
      console.log(`[executeStep] persistent process failed: ${err.message}`);
      result = null;
    }

    if (!result || !result.output) {
      // Resume failed: rebuild with agent prompt + history summary
      console.log(`[executeStep] resume failed, starting fresh with history`);
      killProcess(workflowId);
      const history = buildHistorySummary(workflowId, wf.conversation_id);
      const historyContext = history ? `\n\n## 之前的对话和执行记录\n\n${history}` : '';
      const firstMessage = `${agentPrompt}${historyContext}\n\n注意：你之前已经执行过部分任务，请检查项目当前状态，继续未完成的工作，不要重头开始。\n\n用户说：${userMessage}`;
      result = await sendMessage(workflowId, firstMessage, {
        cwd,
        broadcastKey: workflowId,
        allowedTools,
        model: agent.model || undefined,
      });
    }
  } else {
    // First execution: kill any existing process (e.g. from previous step) since allowedTools may differ
    killProcess(workflowId);
    console.log(`[executeStep] new session for ${step.step_name} (${agent.model || 'default'})`);
    const firstMessage = `${agentPrompt}\n\n开始执行：${userMessage}`;
    result = await sendMessage(workflowId, firstMessage, {
      cwd,
      broadcastKey: workflowId,
      allowedTools,
      model: agent.model || undefined,
    });
  }

  // Save step session_id
  if (result.sessionId) {
    db.prepare('UPDATE workflow_steps SET session_id = ? WHERE id = ?').run(result.sessionId, step.id);
  }

  // Save assistant message
  if (result.output) {
    db.prepare('INSERT INTO chat_messages (workflow_id, conversation_id, role, content) VALUES (?, ?, ?, ?)').run(workflowId, convId || null, 'assistant', result.output);
    broadcast(workflowId, 'chat-message', { role: 'assistant', content: result.output });
  }

  // Notify step done (status stays in-progress until user clicks next)
  broadcast(workflowId, 'step-done', { step: step.step_name });

  return result;
}

// Advance to next step in sequence
export function advanceStep(workflowId) {
  const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId);
  const template = db.prepare('SELECT step_sequence FROM workflow_templates WHERE id = ?').get(wf.template_id);
  const steps = JSON.parse(template.step_sequence);
  const flatSteps = steps.flatMap(s => Array.isArray(s) ? s : [s]);

  const currentIdx = flatSteps.indexOf(wf.current_step);
  if (currentIdx < 0 || currentIdx >= flatSteps.length - 1) {
    // Last step done → workflow completed
    db.prepare("UPDATE workflows SET status = 'completed', updated_at = datetime('now') WHERE id = ?").run(workflowId);
    broadcast(workflowId, 'state', { status: 'completed' });
    // Kill persistent process for this workflow
    killProcess(workflowId);
    return null;
  }

  const nextStep = flatSteps[currentIdx + 1];
  db.prepare("UPDATE workflows SET current_step = ?, updated_at = datetime('now') WHERE id = ?").run(nextStep, workflowId);
  return nextStep;
}

// Auto mode: independent background loop
export async function runAutoMode(workflowId) {
  if (autoModeRunning.has(workflowId)) return;
  autoModeRunning.add(workflowId);
  try {
  while (true) {
    const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId);
    if (!wf || wf.status !== 'in-progress' || !wf.auto_mode) break;

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(wf.project_id);
    const cwd = wf.worktree_dir || join(PROJECTS_DIR, project.name);
    const step = db.prepare('SELECT * FROM workflow_steps WHERE workflow_id = ? AND step_name = ?')
      .get(workflowId, wf.current_step);
    const agent = db.prepare('SELECT * FROM agents WHERE name = ?').get(step.step_name);

    // Skip interactive agents — pause and wait for user
    if (agent?.interactive) {
      broadcast(workflowId, 'auto-pause', { reason: '需要用户操作', step: step.step_name });
      break;
    }

    // Execute if not yet started
    if (step.status === 'pending') {
      const result = await executeStep(workflowId, '开始执行');

      if (result.code !== 0) {
        broadcast(workflowId, 'auto-pause', { reason: '执行失败', step: step.step_name });
        break;
      }

      // Check outputs exist
      const outputs = JSON.parse(agent.outputs || '[]');
      const missing = outputs.filter(f => !existsSync(join(cwd, f)));
      if (missing.length > 0) {
        broadcast(workflowId, 'auto-pause', { reason: '输出文件缺失: ' + missing.join(', '), step: step.step_name });
        break;
      }
    }

    // Mark completed + advance
    db.prepare("UPDATE workflow_steps SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(step.id);
    broadcast(workflowId, 'state', { steps: { [step.step_name]: { status: 'completed' } } });

    const nextStep = advanceStep(workflowId);
    if (!nextStep) break;

    broadcast(workflowId, 'auto-continue', { nextStep });
  }
  } finally {
    autoModeRunning.delete(workflowId);
  }
}

// Re-execute current step with user feedback
export async function retryStep(workflowId, feedback) {
  const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId);
  const step = db.prepare('SELECT * FROM workflow_steps WHERE workflow_id = ? AND step_name = ?').get(workflowId, wf.current_step);

  // Reset step status
  db.prepare("UPDATE workflow_steps SET status = 'in-progress' WHERE id = ?").run(step.id);

  return executeStep(workflowId, feedback);
}

// ─── Send message to Claude main session (workflow completed, direct chat) ───
export async function sendMessage_workflow(workflowId, message) {
  const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId);
  if (!wf) throw new Error('Workflow not found');

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(wf.project_id);
  const projectDir = wf.worktree_dir || join(PROJECTS_DIR, project.name);

  // Save user message
  const convId = wf.conversation_id;
  db.prepare('INSERT INTO chat_messages (workflow_id, conversation_id, role, content) VALUES (?, ?, ?, ?)')
    .run(workflowId, convId || null, 'user', message);
  broadcast(workflowId, 'chat-message', { role: 'user', content: message });

  // Direct chat mode prompt
  const rolePrompt = `你是一位资深全栈工程师，在项目 "${project.name}" 目录下工作。用户描述了一个问题或需求，请直接阅读相关代码、定位问题、修复它。修复后简要说明改了什么。`;

  let result;
  if (wf.session_id) {
    // Try to reuse persistent process or resume
    console.log(`[sendMessage] resuming session ${wf.session_id.slice(0, 8)} for workflow ${workflowId}`);
    try {
      result = await sendMessage(workflowId, message, {
        cwd: projectDir,
        sessionId: wf.session_id,
        broadcastKey: workflowId,
      });
    } catch (err) {
      console.log(`[sendMessage] persistent process failed: ${err.message}`);
      result = null;
    }

    if (!result || !result.output) {
      console.log(`[sendMessage] resume failed, starting new session with history`);
      killProcess(workflowId);
      db.prepare('UPDATE workflows SET session_id = NULL WHERE id = ?').run(workflowId);

      const history = buildHistorySummary(workflowId, convId);
      const historyContext = history ? `\n\n## 之前的对话摘要\n\n${history}` : '';
      const firstMessage = `${rolePrompt}${historyContext}\n\n${message}`;

      result = await sendMessage(workflowId, firstMessage, {
        cwd: projectDir,
        broadcastKey: workflowId,
      });
    }
  } else {
    // First message: put role prompt in message so it persists on resume
    console.log(`[sendMessage] no session, starting fresh for workflow ${workflowId}`);
    const firstMessage = `${rolePrompt}\n\n${message}`;
    result = await sendMessage(workflowId, firstMessage, {
      cwd: projectDir,
      broadcastKey: workflowId,
    });
  }

  console.log(`[sendMessage] result: code=${result.code}, sessionId=${result.sessionId?.slice(0, 8)}, output=${result.output?.length} chars`);

  // Save session ID
  if (result.sessionId) {
    db.prepare(`UPDATE workflows SET session_id = ?, updated_at = datetime('now') WHERE id = ?`).run(result.sessionId, workflowId);
  }

  // Save assistant message
  if (result.output) {
    db.prepare('INSERT INTO chat_messages (workflow_id, conversation_id, role, content) VALUES (?, ?, ?, ?)')
      .run(workflowId, convId || null, 'assistant', result.output);
    broadcast(workflowId, 'chat-message', { role: 'assistant', content: result.output });
  }

  return result;
}
