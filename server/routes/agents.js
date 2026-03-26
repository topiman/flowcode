import { Router } from 'express';
import db from '../db.js';

const router = Router();

// List all agents with their skills
router.get('/', (req, res) => {
  const agents = db.prepare('SELECT * FROM agents ORDER BY sort_order').all();
  for (const agent of agents) {
    try { agent.inputs = JSON.parse(agent.inputs || '[]'); } catch { agent.inputs = []; }
    try { agent.outputs = JSON.parse(agent.outputs || '[]'); } catch { agent.outputs = []; }
    agent.skills = db.prepare(`
      SELECT s.id, s.name, s.label, s.type, ags.role, ags.sort_order
      FROM agent_skills ags JOIN skills s ON s.id = ags.skill_id
      WHERE ags.agent_id = ? ORDER BY ags.sort_order
    `).all(agent.id);
  }
  res.json(agents);
});

// Get single agent with full skill content
router.get('/:id', (req, res) => {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'not found' });
  try { agent.inputs = JSON.parse(agent.inputs || '[]'); } catch { agent.inputs = []; }
  try { agent.outputs = JSON.parse(agent.outputs || '[]'); } catch { agent.outputs = []; }
  agent.skills = db.prepare(`
    SELECT s.*, ags.role as skill_role, ags.sort_order as link_order
    FROM agent_skills ags JOIN skills s ON s.id = ags.skill_id
    WHERE ags.agent_id = ? ORDER BY ags.sort_order
  `).all(agent.id);
  res.json(agent);
});

// Create agent
router.post('/', (req, res) => {
  const { name, label, role, model } = req.body;
  if (!name || !label) return res.status(400).json({ error: 'name and label required' });
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM agents').get();
  const r = db.prepare('INSERT INTO agents (name, label, role, model, sort_order) VALUES (?, ?, ?, ?, ?)')
    .run(name, label, role || '', model || null, (maxOrder?.m || 0) + 1);
  res.json({ id: r.lastInsertRowid });
});

// Update agent
router.put('/:id', (req, res) => {
  const { label, role, prompt, model, inputs, outputs } = req.body;
  db.prepare('UPDATE agents SET label = ?, role = ?, prompt = ?, model = ?, inputs = ?, outputs = ? WHERE id = ?')
    .run(label, role, prompt ?? '', model, JSON.stringify(inputs || []), JSON.stringify(outputs || []), req.params.id);
  res.json({ ok: true });
});

// Add skill to agent
router.post('/:id/skills', (req, res) => {
  const { skillId, role } = req.body;
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM agent_skills WHERE agent_id = ?').get(req.params.id);
  db.prepare('INSERT OR IGNORE INTO agent_skills (agent_id, skill_id, role, sort_order) VALUES (?, ?, ?, ?)')
    .run(req.params.id, skillId, role || 'prompt', (maxOrder?.m || 0) + 1);
  res.json({ ok: true });
});

// Remove skill from agent
router.delete('/:id/skills/:skillId', (req, res) => {
  db.prepare('DELETE FROM agent_skills WHERE agent_id = ? AND skill_id = ?').run(req.params.id, req.params.skillId);
  res.json({ ok: true });
});

// Delete agent
router.delete('/:id', (req, res) => {
  const agent = db.prepare('SELECT name, label FROM agents WHERE id = ?').get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'not found' });

  // Check if any workflow template references this agent
  const templates = db.prepare('SELECT id, name, step_sequence FROM workflow_templates').all();
  const referencedBy = templates.filter(t => {
    const steps = JSON.parse(t.step_sequence || '[]');
    return steps.includes(agent.name);
  });

  if (referencedBy.length > 0) {
    return res.status(409).json({
      error: `该 Agent 被以下工作流引用，请先移除引用：${referencedBy.map(t => t.name).join(', ')}`,
    });
  }

  db.prepare('DELETE FROM agent_skills WHERE agent_id = ?').run(req.params.id);
  db.prepare('DELETE FROM agents WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
