import { Router } from 'express';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import db from '../db.js';
import { sendConversationMessage, isRunning, getProcessInfo } from '../services/claude.js';
import { addClient, broadcast } from '../services/sse.js';

const UPLOAD_DIR = '/tmp/workflow-uploads';
mkdirSync(UPLOAD_DIR, { recursive: true });

const router = Router();

// List all conversations
router.get('/', (req, res) => {
  const conversations = db.prepare('SELECT * FROM conversations ORDER BY created_at DESC').all();
  res.json(conversations);
});

// Get single conversation with messages
router.get('/:id', (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'not found' });
  const messages = db.prepare('SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at').all(conv.id);
  res.json({ ...conv, messages });
});

// Create new conversation
router.post('/', (req, res) => {
  const { name, projectId } = req.body;
  let convName = name || '新的需求沟通';

  // If based on existing project, use project name
  if (projectId) {
    const project = db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId);
    if (project) convName = project.name;
  }

  const r = db.prepare('INSERT INTO conversations (name, project_id) VALUES (?, ?)')
    .run(convName, projectId || null);
  console.log(`[conversation] created conv=${r.lastInsertRowid} name=${convName} projectId=${projectId || 'none'}`);
  res.json({ id: r.lastInsertRowid });

  // Auto-start: trigger AI to begin asking questions
  sendConversationMessage(r.lastInsertRowid, '开始').catch(err => {
    console.error('[conversation] auto-start failed:', err.message);
  });
});

// Send message in conversation
router.post('/:id/message', (req, res) => {
  const { message, images } = req.body;
  const convId = parseInt(req.params.id);
  if (!message) return res.status(400).json({ error: 'missing message' });
  console.log(`[conversation] POST conv=${convId} msg=${message.slice(0, 60)} running=${isRunning(`conv:${convId}`)}`);
  if (isRunning(`conv:${convId}`)) return res.status(409).json({ error: '正在执行中' });

  // Save images and files, prepend references
  let fullMessage = message;
  const refs = [];

  if (images && Array.isArray(images) && images.length > 0) {
    for (const img of images) {
      const ext = img.type?.split('/')[1] || 'png';
      const filename = `${randomUUID()}.${ext}`;
      const filepath = join(UPLOAD_DIR, filename);
      writeFileSync(filepath, Buffer.from(img.data, 'base64'));
      refs.push(`[用户附带了截图，请用 Read 工具查看: ${filepath}]`);
    }
  }

  const { files } = req.body;
  console.log(`[conversation] message received: images=${images?.length || 0}, files=${files?.length || 0}`);
  if (files && Array.isArray(files) && files.length > 0) {
    for (const file of files) {
      const filename = `${randomUUID()}-${file.name || 'file'}`;
      const filepath = join(UPLOAD_DIR, filename);
      const buf = Buffer.from(file.data, 'base64');
      writeFileSync(filepath, buf);
      // Inline text file content directly; for binary files, ask Claude to Read
      const textExts = ['.md', '.txt', '.json', '.yaml', '.yml', '.csv', '.xml', '.html', '.css', '.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs', '.java', '.sh', '.sql', '.toml', '.ini', '.cfg', '.env'];
      const ext = (file.name || '').substring((file.name || '').lastIndexOf('.')).toLowerCase();
      if (textExts.includes(ext)) {
        const content = buf.toString('utf-8');
        refs.push(`用户上传了文件 "${file.name}"，内容如下：\n\n\`\`\`\n${content}\n\`\`\``);
      } else {
        refs.push(`[用户上传了文件 "${file.name}"，请用 Read 工具查看: ${filepath}]`);
      }
    }
  }

  if (refs.length > 0) {
    fullMessage = `${refs.join('\n')}\n\n${message}`;
  }

  // Build display message (what user sees in chat) with attachment labels only
  const attachmentLabels = [];
  if (images && images.length > 0) attachmentLabels.push(`📷 ${images.length} 张图片`);
  if (files && files.length > 0) attachmentLabels.push(...files.map(f => `📄 ${f.name}`));
  const displayMessage = attachmentLabels.length > 0 ? `${attachmentLabels.join('  ')}\n\n${message}` : message;

  res.json({ ok: true });

  sendConversationMessage(convId, fullMessage, displayMessage).catch(err => {
    console.error(`[conversation] error:`, err.message);
    broadcast(`conv:${convId}`, 'error', { message: err.message });
  });
});

// Update conversation (confirm requirements)
router.put('/:id', (req, res) => {
  const { name, status, requirement_brief, tech_stack, deploy_config, project_name } = req.body;
  const updates = [];
  const params = [];
  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (status !== undefined) { updates.push('status = ?'); params.push(status); }
  if (requirement_brief !== undefined) { updates.push('requirement_brief = ?'); params.push(requirement_brief); }
  if (tech_stack !== undefined) { updates.push('tech_stack = ?'); params.push(typeof tech_stack === 'string' ? tech_stack : JSON.stringify(tech_stack)); }
  if (deploy_config !== undefined) { updates.push('deploy_config = ?'); params.push(typeof deploy_config === 'string' ? deploy_config : JSON.stringify(deploy_config)); }
  if (project_name !== undefined) { updates.push('project_name = ?'); params.push(project_name); }
  if (updates.length === 0) return res.json({ ok: true });
  params.push(req.params.id);
  db.prepare(`UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ ok: true });
});

// Delete conversation
router.delete('/:id', (req, res) => {
  console.log(`[conversation] delete conv=${req.params.id}`);
  db.prepare('DELETE FROM chat_messages WHERE conversation_id = ?').run(req.params.id);
  db.prepare('DELETE FROM conversations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Session stats from persistent process
router.get('/:id/session-stats', (req, res) => {
  const info = getProcessInfo(`conv:${req.params.id}`);
  if (!info) return res.json({ stats: null, initInfo: null });
  res.json({ stats: info.stats, initInfo: info.initInfo });
});

// SSE for conversation
router.get('/:id/events', (req, res) => {
  const convId = parseInt(req.params.id);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.write(`event: connected\ndata: {}\n\n`);
  addClient(`conv:${convId}`, res);
});

export default router;
