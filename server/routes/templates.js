import { Router } from 'express';
import db from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const { scope } = req.query;
  let sql = 'SELECT * FROM workflow_templates';
  const params = [];
  if (scope) {
    sql += " WHERE scope = ? OR scope = 'all'";
    params.push(scope);
  }
  sql += ' ORDER BY id';
  const templates = db.prepare(sql).all(...params);
  res.json(templates.map(t => ({
    ...t,
    step_sequence: JSON.parse(t.step_sequence),
    tech_stack: (() => { try { return JSON.parse(t.tech_stack); } catch { return {}; } })(),
    branch_config: (() => { try { return JSON.parse(t.branch_config); } catch { return {}; } })(),
  })));
});

router.post('/', (req, res) => {
  const { name, step_sequence, description, tech_stack, scope } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const r = db.prepare('INSERT INTO workflow_templates (name, description, tech_stack, step_sequence, scope) VALUES (?, ?, ?, ?, ?)')
    .run(name, description || '', tech_stack ? JSON.stringify(tech_stack) : '{}', JSON.stringify(step_sequence || []), scope || 'all');
  res.json({ id: r.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const { name, step_sequence, description, tech_stack, branch_config, scope } = req.body;
  if (name !== undefined) db.prepare('UPDATE workflow_templates SET name = ? WHERE id = ?').run(name, req.params.id);
  if (description !== undefined) db.prepare('UPDATE workflow_templates SET description = ? WHERE id = ?').run(description, req.params.id);
  if (tech_stack !== undefined) db.prepare('UPDATE workflow_templates SET tech_stack = ? WHERE id = ?').run(typeof tech_stack === 'string' ? tech_stack : JSON.stringify(tech_stack), req.params.id);
  if (Array.isArray(step_sequence)) db.prepare('UPDATE workflow_templates SET step_sequence = ? WHERE id = ?').run(JSON.stringify(step_sequence), req.params.id);
  if (branch_config !== undefined) db.prepare('UPDATE workflow_templates SET branch_config = ? WHERE id = ?').run(typeof branch_config === 'string' ? branch_config : JSON.stringify(branch_config), req.params.id);
  if (scope !== undefined) db.prepare('UPDATE workflow_templates SET scope = ? WHERE id = ?').run(scope, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM workflow_templates WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
