import { Router } from 'express';
import db from '../db.js';

const router = Router();

// ─── Skill Types (must be before /:id routes) ───
router.get('/types', (req, res) => {
  res.json(db.prepare('SELECT * FROM skill_types ORDER BY sort_order').all());
});

router.post('/types', (req, res) => {
  const { name, label, instruction } = req.body;
  if (!name || !label) return res.status(400).json({ error: 'name and label required' });
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM skill_types').get();
  const r = db.prepare('INSERT INTO skill_types (name, label, instruction, sort_order) VALUES (?, ?, ?, ?)')
    .run(name, label, instruction || '', (maxOrder?.m || 0) + 1);
  res.json({ id: r.lastInsertRowid });
});

router.put('/types/:id', (req, res) => {
  const { name, label, instruction } = req.body;
  db.prepare('UPDATE skill_types SET name = ?, label = ?, instruction = ? WHERE id = ?')
    .run(name, label, instruction, req.params.id);
  res.json({ ok: true });
});

router.delete('/types/:id', (req, res) => {
  const st = db.prepare('SELECT name FROM skill_types WHERE id = ?').get(req.params.id);
  if (st) {
    const count = db.prepare('SELECT COUNT(*) as c FROM skills WHERE type = ?').get(st.name);
    if (count.c > 0) return res.status(409).json({ error: `还有 ${count.c} 个 Skill 使用此类型，请先修改` });
  }
  db.prepare('DELETE FROM skill_types WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Skills ───
router.get('/', (req, res) => {
  const { type } = req.query;
  const skills = type
    ? db.prepare('SELECT * FROM skills WHERE type = ? ORDER BY sort_order').all(type)
    : db.prepare('SELECT * FROM skills ORDER BY type, sort_order').all();
  res.json(skills);
});

router.get('/:id', (req, res) => {
  const skill = db.prepare('SELECT * FROM skills WHERE id = ?').get(req.params.id);
  if (!skill) return res.status(404).json({ error: 'not found' });
  const agents = db.prepare(`
    SELECT a.id, a.name, a.label, ags.role FROM agent_skills ags
    JOIN agents a ON a.id = ags.agent_id
    WHERE ags.skill_id = ? ORDER BY a.sort_order
  `).all(skill.id);
  res.json({ ...skill, agents });
});

router.post('/', (req, res) => {
  const { name, label, type, content } = req.body;
  if (!name || !label) return res.status(400).json({ error: 'name and label required' });
  const r = db.prepare('INSERT INTO skills (name, label, type, content) VALUES (?, ?, ?, ?)')
    .run(name, label, type || 'instruction', content || '');
  res.json({ id: r.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const { name, label, type, content } = req.body;
  db.prepare('UPDATE skills SET name = ?, label = ?, type = ?, content = ? WHERE id = ?')
    .run(name, label, type, content, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM agent_skills WHERE skill_id = ?').run(req.params.id);
  db.prepare('DELETE FROM skills WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
