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

  const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId);
  if (!wf) return res.status(404).json({ error: 'workflow not found' });

  console.log(`[message] wf=${workflowId} status=${wf.status} current_step=${wf.current_step} msg=${message.slice(0, 50)}`);

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
      console.log(`[message] workflow completed, sending direct message`);
      await sendWorkflowMessage(workflowId, fullMessage);
    } else {
      const step = db.prepare('SELECT * FROM workflow_steps WHERE workflow_id = ? AND step_name = ?')
        .get(workflowId, wf.current_step);

      console.log(`[message] step=${step?.step_name} status=${step?.status} session=${step?.session_id?.slice(0, 8) || 'none'}`);

      if (!step || step.status === 'pending') {
        console.log(`[message] first execution of step`);
        await executeStep(workflowId, fullMessage);
      } else {
        console.log(`[message] resuming step session`);
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
