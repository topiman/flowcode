import { Router } from 'express';
import { join } from 'path';
import { existsSync } from 'fs';
import { PROJECTS_DIR } from '../config.js';
import db from '../db.js';
import { cancelRun, killProcess, executeStep, advanceStep, isRunning, runAutoMode, sendCommand, isAlive, getProcessInfo } from '../services/claude.js';
import { addClient, broadcast } from '../services/sse.js';

const router = Router();

// Get workflow details with steps
router.get('/:id', (req, res) => {
  const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(req.params.id);
  if (!wf) return res.status(404).json({ error: 'not found' });

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(wf.project_id);

  const steps = db.prepare('SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY sort_order').all(wf.id);
  const template = wf.template_id ? db.prepare('SELECT * FROM workflow_templates WHERE id = ?').get(wf.template_id) : null;

  // Attach agent model info to each step
  const agentMap = {};
  db.prepare('SELECT name, model, label FROM agents').all().forEach(a => { agentMap[a.name] = a; });
  const stepsWithModel = steps.map(s => ({ ...s, model: agentMap[s.step_name]?.model || null }));

  res.json({ ...wf, steps: stepsWithModel, project, stepSequence: template ? JSON.parse(template.step_sequence) : [], isRunning: isRunning(wf.id) });
});

// Chat history (include messages from linked conversation)
router.get('/:id/chat', (req, res) => {
  const wf = db.prepare('SELECT conversation_id FROM workflows WHERE id = ?').get(req.params.id);
  let messages;
  if (wf?.conversation_id) {
    messages = db.prepare(
      'SELECT * FROM chat_messages WHERE workflow_id = ? OR conversation_id = ? ORDER BY created_at'
    ).all(req.params.id, wf.conversation_id);
  } else {
    messages = db.prepare('SELECT * FROM chat_messages WHERE workflow_id = ? ORDER BY created_at').all(req.params.id);
  }
  res.json(messages);
});

// Delete workflow
router.delete('/:id', (req, res) => {
  const id = req.params.id;
  db.prepare('DELETE FROM step_logs WHERE workflow_step_id IN (SELECT id FROM workflow_steps WHERE workflow_id = ?)').run(id);
  db.prepare('DELETE FROM workflow_steps WHERE workflow_id = ?').run(id);
  db.prepare('DELETE FROM chat_messages WHERE workflow_id = ?').run(id);
  db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
  res.json({ ok: true });
});

// Advance to next step and execute
router.post('/:id/next', async (req, res) => {
  const wfId = parseInt(req.params.id);
  const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(wfId);
  if (!wf) return res.status(404).json({ error: 'not found' });

  console.log(`[next] wf=${wfId} current_step=${wf.current_step} status=${wf.status}`);

  // Check current step status
  const currentStep = db.prepare('SELECT status FROM workflow_steps WHERE workflow_id = ? AND step_name = ?').get(wfId, wf.current_step);
  console.log(`[next] step status=${currentStep?.status || 'not found'}`);

  // If pending, execute it first
  if (!currentStep || currentStep.status === 'pending') {
    console.log(`[next] step is pending, executing ${wf.current_step}`);
    res.json({ ok: true, executing: wf.current_step });
    executeStep(wfId, '开始执行').catch(err => {
      console.error(`[next] auto-execute failed:`, err.message);
    });
    return;
  }

  // in-progress or completed are both OK to advance

  // Mark current step completed
  db.prepare("UPDATE workflow_steps SET status = 'completed', completed_at = datetime('now') WHERE workflow_id = ? AND step_name = ?")
    .run(wfId, wf.current_step);
  broadcast(wfId, 'state', { steps: { [wf.current_step]: { status: 'completed' } } });
  console.log(`[next] marked ${wf.current_step} as completed`);

  // Advance to next step
  const nextStep = advanceStep(wfId);
  if (!nextStep) {
    console.log(`[next] no more steps, workflow completed`);
    return res.json({ ok: true, completed: true });
  }

  console.log(`[next] advancing to ${nextStep}, starting execution`);
  res.json({ ok: true, nextStep });

  // Execute next step
  executeStep(wfId, '开始执行').catch(err => {
    console.error(`[next] executeStep failed for ${nextStep}:`, err.message);
    broadcast(wfId, 'error', { message: err.message });
  });
});

// Check output files for current step (used by confirm dialog)
router.get('/:id/check-outputs', (req, res) => {
  const wfId = parseInt(req.params.id);
  const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(wfId);
  if (!wf) return res.status(404).json({ error: 'not found' });

  const agent = db.prepare('SELECT label, outputs FROM agents WHERE name = ?').get(wf.current_step);
  const project = db.prepare('SELECT name FROM projects WHERE id = ?').get(wf.project_id);
  const cwd = wf.worktree_dir || join(PROJECTS_DIR, project.name);
  const outputs = JSON.parse(agent?.outputs || '[]');

  res.json({
    step: wf.current_step,
    label: agent?.label || wf.current_step,
    outputs: outputs.map(f => ({ file: f, exists: existsSync(join(cwd, f)) })),
  });
});

// Go back to previous step
router.post('/:id/prev', (req, res) => {
  const wfId = parseInt(req.params.id);
  const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(wfId);
  if (!wf) return res.status(404).json({ error: 'not found' });
  if (isRunning(wfId)) return res.status(409).json({ error: '正在执行中' });
  console.log(`[prev] wf=${wfId} current_step=${wf.current_step}`);

  const template = db.prepare('SELECT step_sequence FROM workflow_templates WHERE id = ?').get(wf.template_id);
  const steps = JSON.parse(template.step_sequence);
  const flatSteps = steps.flatMap(s => Array.isArray(s) ? s : [s]);
  const currentIdx = flatSteps.indexOf(wf.current_step);

  if (currentIdx <= 0) {
    return res.status(400).json({ error: '已经是第一步，无法回退' });
  }

  const prevStep = flatSteps[currentIdx - 1];

  // Kill current process to avoid session conflict when resuming previous step
  killProcess(wfId);

  // Reset current step to pending
  db.prepare("UPDATE workflow_steps SET status = 'pending', session_id = NULL WHERE workflow_id = ? AND step_name = ?")
    .run(wfId, wf.current_step);

  // Restore previous step to in-progress (keep session_id for continued conversation)
  db.prepare("UPDATE workflow_steps SET status = 'in-progress', completed_at = NULL WHERE workflow_id = ? AND step_name = ?")
    .run(wfId, prevStep);

  // Move current_step back
  db.prepare("UPDATE workflows SET current_step = ?, updated_at = datetime('now') WHERE id = ?")
    .run(prevStep, wfId);

  broadcast(wfId, 'state', {
    currentStep: prevStep,
    steps: {
      [wf.current_step]: { status: 'pending' },
      [prevStep]: { status: 'in-progress' },
    },
  });

  console.log(`[prev] rolled back to ${prevStep}`);
  res.json({ ok: true, prevStep });
});

// Toggle auto-mode
router.post('/:id/auto-mode', (req, res) => {
  const { enabled } = req.body;
  const wfId = parseInt(req.params.id);
  db.prepare(`UPDATE workflows SET auto_mode = ?, updated_at = datetime('now') WHERE id = ?`).run(enabled ? 1 : 0, wfId);
  res.json({ ok: true, enabled: !!enabled });

  if (enabled) {
    runAutoMode(wfId).catch(err => {
      broadcast(wfId, 'error', { message: err.message });
    });
  }
});

// Cancel
router.post('/:id/cancel', (req, res) => {
  cancelRun(parseInt(req.params.id));
  res.json({ ok: true });
});

// Reset session
router.post('/:id/reset-session', (req, res) => {
  const wfId = parseInt(req.params.id);
  killProcess(wfId);
  db.prepare(`UPDATE workflows SET session_id = NULL, updated_at = datetime('now') WHERE id = ?`).run(wfId);
  res.json({ ok: true });
});

// Step log
router.get('/:id/steps/:stepName/log', (req, res) => {
  const step = db.prepare('SELECT * FROM workflow_steps WHERE workflow_id = ? AND step_name = ?').get(req.params.id, req.params.stepName);
  if (!step) return res.json({ log: '' });
  const logs = db.prepare('SELECT content FROM step_logs WHERE workflow_step_id = ? ORDER BY created_at').all(step.id);
  res.json({ log: logs.map(l => l.content).join('') });
});

// SSE events
router.get('/:id/events', (req, res) => {
  const wfId = parseInt(req.params.id);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.write(`event: connected\ndata: {}\n\n`);
  addClient(wfId, res);
});

// Session stats (from persistent process pool)
router.get('/:id/session-stats', (req, res) => {
  const wfId = parseInt(req.params.id);
  const info = getProcessInfo(wfId);
  if (!info) return res.json({ stats: null, initInfo: null });
  res.json({ stats: info.stats, initInfo: info.initInfo });
});

// Context info (runs /context via persistent process)
router.get('/:id/context', async (req, res) => {
  const wfId = parseInt(req.params.id);
  const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(wfId);
  if (!wf) return res.status(404).json({ error: 'not found' });

  // Find a session to query context: workflow-level, current step, or most recent step with a session
  let sessionId = wf.session_id;
  if (!sessionId && wf.current_step) {
    const step = db.prepare('SELECT session_id FROM workflow_steps WHERE workflow_id = ? AND step_name = ?').get(wfId, wf.current_step);
    sessionId = step?.session_id;
  }
  if (!sessionId) {
    const lastStep = db.prepare('SELECT session_id FROM workflow_steps WHERE workflow_id = ? AND session_id IS NOT NULL ORDER BY sort_order DESC LIMIT 1').get(wfId);
    sessionId = lastStep?.session_id;
  }

  if (!sessionId && !isAlive(wfId)) {
    return res.json({ model: '', used: 0, total: 0, pct: 0, categories: [] });
  }

  try {
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(wf.project_id);
    const cwd = wf.worktree_dir || join(PROJECTS_DIR, project.name);
    const result = await sendCommand(wfId, '/context', { cwd, sessionId, broadcastKey: wfId });
    res.json(parseContext(result));
  } catch {
    res.json({ model: '', used: 0, total: 0, pct: 0, categories: [] });
  }
});

function parseContext(md) {
  const r = { model: '', used: 0, total: 0, pct: 0, categories: [] };
  const mm = md.match(/\*\*Model:\*\*\s*(\S+)/);
  if (mm) r.model = mm[1];
  const tm = md.match(/\*\*Tokens:\*\*\s*([\d.]+[kKmM]?)\s*\/\s*([\d.]+[kKmM]?)\s*\((\d+)%\)/);
  if (tm) { r.used = parseNum(tm[1]); r.total = parseNum(tm[2]); r.pct = parseInt(tm[3]); }
  const rows = md.match(/\|\s*([^|]+)\|\s*([\d.,]+[kKmM]?)\s*\|\s*([\d.]+%)\s*\|/g);
  if (rows) {
    for (const row of rows) {
      const m = row.match(/\|\s*([^|]+?)\s*\|\s*([\d.,]+[kKmM]?)\s*\|\s*([\d.]+)%\s*\|/);
      if (m && !m[1].includes('Category')) r.categories.push({ name: m[1].trim(), tokens: parseNum(m[2]), pct: parseFloat(m[3]) });
    }
  }
  return r;
}
function parseNum(s) { s = s.replace(/,/g, ''); const n = parseFloat(s); if (s.toLowerCase().endsWith('k')) return Math.round(n*1000); if (s.toLowerCase().endsWith('m')) return Math.round(n*1000000); return Math.round(n); }

export default router;
