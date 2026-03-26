import { Router } from 'express';
import { join } from 'path';
import db from '../db.js';
import { PROJECTS_DIR } from '../config.js';
import { sendCommand, isRunning, isAlive, cancelRun, killProcess, getProcessInfo } from '../services/claude-process.js';
import { broadcast } from '../services/sse.js';

const router = Router();

/**
 * POST /api/commands
 * body: { command, workflowId?, conversationId? }
 *
 * CLI commands (/context, /cost, /compact) are sent to the persistent process.
 * App-level commands (/cancel, /new, /status) are handled here.
 */
router.post('/', async (req, res) => {
  const { command, workflowId, conversationId } = req.body;
  if (!command) return res.status(400).json({ error: 'missing command' });

  const baseCommand = command.split(/\s+/)[0].toLowerCase();

  // App-level commands
  if (baseCommand === '/cancel') return handleCancel(res, { workflowId, conversationId });
  if (baseCommand === '/new') return handleNew(res, { workflowId, conversationId });
  if (baseCommand === '/status') return handleStatus(res, { workflowId, conversationId });

  // CLI commands — send to persistent process
  const key = workflowId || (conversationId ? `conv:${conversationId}` : null);
  if (!key) return res.json({ ok: false, message: '缺少 workflowId 或 conversationId' });

  // Don't queue CLI commands behind a busy process — return immediately
  if (isRunning(key)) {
    return res.json({ ok: false, message: '进程执行中，请稍后再试。' });
  }

  const { sessionId, cwd } = resolveSession({ workflowId, conversationId });

  if (!isAlive(key) && !sessionId) {
    return res.json({ ok: false, message: '当前没有活跃的 session，无法执行 CLI 命令。先发送一条消息建立 session。' });
  }

  try {
    const result = await sendCommand(key, command, {
      cwd,
      sessionId,
      broadcastKey: key,
    });
    return res.json({ ok: true, message: result || '(命令已执行)' });
  } catch (err) {
    return res.json({ ok: false, message: `命令执行失败: ${err.message}` });
  }
});

function resolveSession({ workflowId, conversationId }) {
  if (workflowId) {
    const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId);
    if (!wf) return {};

    let sessionId = wf.session_id;
    if (!sessionId && wf.current_step) {
      const step = db.prepare('SELECT session_id FROM workflow_steps WHERE workflow_id = ? AND step_name = ?')
        .get(workflowId, wf.current_step);
      sessionId = step?.session_id;
    }

    const project = db.prepare('SELECT name FROM projects WHERE id = ?').get(wf.project_id);
    const cwd = wf.worktree_dir || (project ? join(PROJECTS_DIR, project.name) : '/tmp');
    return { sessionId, cwd };
  }

  if (conversationId) {
    const conv = db.prepare('SELECT session_id FROM conversations WHERE id = ?').get(conversationId);
    return { sessionId: conv?.session_id, cwd: '/tmp' };
  }

  return {};
}

// ─── App-level command handlers ───

function handleCancel(res, { workflowId, conversationId }) {
  const key = workflowId || (conversationId ? `conv:${conversationId}` : null);
  if (!key) return res.json({ ok: false, message: '缺少 workflowId 或 conversationId' });

  if (!isRunning(key)) {
    return res.json({ ok: true, message: '当前没有正在运行的任务。' });
  }

  cancelRun(key);
  broadcast(key, 'stream-end', {});
  return res.json({ ok: true, message: '已取消当前任务。' });
}

function handleNew(res, { workflowId, conversationId }) {
  if (workflowId) {
    const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId);
    if (!wf) return res.json({ ok: false, message: '工作流不存在' });

    killProcess(workflowId);
    db.prepare("UPDATE workflows SET session_id = NULL, updated_at = datetime('now') WHERE id = ?").run(workflowId);
    if (wf.current_step) {
      db.prepare("UPDATE workflow_steps SET session_id = NULL WHERE workflow_id = ? AND step_name = ?")
        .run(workflowId, wf.current_step);
    }
    return res.json({ ok: true, message: '已清除 session 并终止进程，下次发消息将开始新会话。' });
  }

  if (conversationId) {
    killProcess(`conv:${conversationId}`);
    db.prepare("UPDATE conversations SET session_id = NULL WHERE id = ?").run(conversationId);
    return res.json({ ok: true, message: '已清除 session 并终止进程，下次发消息将开始新会话。' });
  }

  return res.json({ ok: false, message: '缺少 workflowId 或 conversationId' });
}

function handleStatus(res, { workflowId, conversationId }) {
  if (workflowId) {
    const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId);
    if (!wf) return res.json({ ok: false, message: '工作流不存在' });

    const step = wf.current_step
      ? db.prepare('SELECT * FROM workflow_steps WHERE workflow_id = ? AND step_name = ?').get(workflowId, wf.current_step)
      : null;
    const totalSteps = db.prepare('SELECT COUNT(*) as cnt FROM workflow_steps WHERE workflow_id = ?').get(workflowId);
    const completedSteps = db.prepare("SELECT COUNT(*) as cnt FROM workflow_steps WHERE workflow_id = ? AND status = 'completed'").get(workflowId);
    const msgCount = db.prepare('SELECT COUNT(*) as cnt FROM chat_messages WHERE workflow_id = ?').get(workflowId);
    const procInfo = getProcessInfo(workflowId);

    const lines = [
      `工作流状态: ${wf.status}`,
      `进度: ${completedSteps.cnt}/${totalSteps.cnt} 步完成`,
      `当前步骤: ${wf.current_step || '无'}${step ? ` (${step.status})` : ''}`,
      `Session: ${wf.session_id ? wf.session_id.slice(0, 12) + '...' : '无'}`,
      `持久进程: ${procInfo ? `PID ${procInfo.pid} (${procInfo.state}), session=${procInfo.sessionId?.slice(0, 12) || 'none'}` : '无'}`,
      `消息数: ${msgCount.cnt}`,
      `自动模式: ${wf.auto_mode ? '开启' : '关闭'}`,
    ];
    return res.json({ ok: true, message: lines.join('\n') });
  }

  if (conversationId) {
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
    if (!conv) return res.json({ ok: false, message: '会话不存在' });

    const msgCount = db.prepare('SELECT COUNT(*) as cnt FROM chat_messages WHERE conversation_id = ?').get(conversationId);
    const procInfo = getProcessInfo(`conv:${conversationId}`);

    const lines = [
      `会话状态: ${conv.status}`,
      `Session: ${conv.session_id ? conv.session_id.slice(0, 12) + '...' : '无'}`,
      `持久进程: ${procInfo ? `PID ${procInfo.pid} (${procInfo.state}), session=${procInfo.sessionId?.slice(0, 12) || 'none'}` : '无'}`,
      `消息数: ${msgCount.cnt}`,
    ];
    return res.json({ ok: true, message: lines.join('\n') });
  }

  return res.json({ ok: false, message: '缺少 workflowId 或 conversationId' });
}

export default router;
