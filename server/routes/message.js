import { Router } from 'express';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import db from '../db.js';
import { sendWorkflowMessage, executeStep, isRunning } from '../services/claude.js';
import { broadcast } from '../services/sse.js';

const UPLOAD_DIR = '/tmp/workflow-uploads';
mkdirSync(UPLOAD_DIR, { recursive: true });

function saveImages(images) {
  if (!images || !Array.isArray(images) || images.length === 0) return [];
  return images.map(img => {
    const ext = img.type?.split('/')[1] || 'png';
    const filename = `${randomUUID()}.${ext}`;
    const filepath = join(UPLOAD_DIR, filename);
    writeFileSync(filepath, Buffer.from(img.data, 'base64'));
    return filepath;
  });
}

const router = Router();

router.post('/', async (req, res) => {
  const { workflowId, message, images } = req.body;
  if (!workflowId || !message) return res.status(400).json({ error: 'missing params' });
  if (isRunning(workflowId)) return res.status(409).json({ error: '正在执行中' });

  const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId);
  if (!wf) return res.status(404).json({ error: 'workflow not found' });

  // Handle images
  const paths = saveImages(images);
  let fullMessage = message;
  if (paths.length > 0) {
    const imgRefs = paths.map(p => `[用户附带了截图，请用 Read 工具查看: ${p}]`).join('\n');
    fullMessage = `${imgRefs}\n\n${message}`;
  }

  res.json({ ok: true });

  try {
    if (wf.status === 'completed') {
      await sendWorkflowMessage(workflowId, fullMessage);
    } else {
      const step = db.prepare('SELECT * FROM workflow_steps WHERE workflow_id = ? AND step_name = ?')
        .get(workflowId, wf.current_step);

      if (!step || step.status === 'pending') {
        // First execution of this step
        await executeStep(workflowId, fullMessage);
      } else {
        // Step in-progress: resume session for continued chat
        await executeStep(workflowId, fullMessage);
      }
    }
  } catch (err) {
    console.error('[message] error:', err.message);
    // Mark step as failed so it doesn't get stuck in in-progress
    try {
      const failedStep = db.prepare('SELECT id FROM workflow_steps WHERE workflow_id = ? AND step_name = ?')
        .get(workflowId, wf.current_step);
      if (failedStep) {
        db.prepare("UPDATE workflow_steps SET status = 'failed' WHERE id = ?").run(failedStep.id);
      }
    } catch {}
    broadcast(workflowId, 'error', { message: err.message });
  }
});

export default router;
