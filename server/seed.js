import db from './db.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Agents ───
const AGENTS = [
  { name: 'agent-01-requirement', label: '需求沟通', role: '资深需求分析师', model: null },
  { name: 'agent-02-brd', label: '商业需求文档', role: '资深商业分析师', model: 'claude-sonnet-4-6' },
  { name: 'agent-03-prd', label: '产品需求文档', role: '资深产品经理', model: 'claude-sonnet-4-6' },
  { name: 'agent-04-tech-design', label: '技术方案设计', role: '资深系统架构师', model: 'claude-opus-4-6' },
{ name: 'agent-05-tdd', label: 'TDD 编码', role: '资深全栈开发工程师', model: 'claude-opus-4-6' },
  { name: 'agent-05-tdd-backend', label: 'TDD 后端', role: '资深后端开发工程师', model: 'claude-opus-4-6' },
  { name: 'agent-05-tdd-frontend', label: 'TDD 前端', role: '资深前端开发工程师', model: 'claude-opus-4-6' },
  { name: 'agent-06-code-review', label: '代码审查', role: '资深代码审查员', model: 'claude-opus-4-6' },
  { name: 'agent-07-e2e-test', label: 'E2E 测试', role: '资深 QA 工程师', model: 'claude-sonnet-4-6' },
  { name: 'agent-08-deploy', label: '部署上线', role: '资深 DevOps 工程师', model: 'claude-sonnet-4-6' },
];

const insertAgent = db.prepare('INSERT OR REPLACE INTO agents (id, name, label, role, model, sort_order) VALUES ((SELECT id FROM agents WHERE name = ?), ?, ?, ?, ?, ?)');
for (let i = 0; i < AGENTS.length; i++) {
  const a = AGENTS[i];
  insertAgent.run(a.name, a.name, a.label, a.role, a.model, i);
}
console.log(`Seeded ${AGENTS.length} agents`);

// ─── Workflow Templates ───
const TEMPLATES = [
  { name: '全新项目', scope: 'new', steps: ['agent-01-requirement','agent-02-brd','agent-03-prd','agent-04-tech-design','agent-05-tdd','agent-06-code-review','agent-07-e2e-test','agent-08-deploy'], branch: {} },
  { name: '新功能', scope: 'iteration', steps: ['agent-01-requirement','agent-03-prd','agent-04-tech-design','agent-05-tdd','agent-06-code-review','agent-07-e2e-test','agent-08-deploy'], branch: { base: 'main', prefix: 'feature', pattern: '{prefix}/{id}-{slug}', idPrefix: 'F' } },
  { name: 'Bug 修复', scope: 'iteration', steps: ['agent-01-requirement','agent-05-tdd','agent-06-code-review','agent-07-e2e-test','agent-08-deploy'], branch: { base: 'main', prefix: 'fix', pattern: '{prefix}/{id}-{slug}', idPrefix: 'B' } },
  { name: '热修复', scope: 'iteration', steps: ['agent-01-requirement','agent-05-tdd','agent-06-code-review','agent-07-e2e-test','agent-08-deploy'], branch: { base: 'main', prefix: 'hotfix', pattern: '{prefix}/{id}-{slug}', idPrefix: 'H' } },
  { name: '重构', scope: 'iteration', steps: ['agent-01-requirement','agent-04-tech-design','agent-05-tdd','agent-06-code-review','agent-07-e2e-test','agent-08-deploy'], branch: { base: 'main', prefix: 'refactor', pattern: '{prefix}/{id}-{slug}', idPrefix: 'R' } },
];

const insertTemplate = db.prepare('INSERT OR REPLACE INTO workflow_templates (id, name, step_sequence, scope, branch_config) VALUES ((SELECT id FROM workflow_templates WHERE name = ?), ?, ?, ?, ?)');
for (const t of TEMPLATES) {
  insertTemplate.run(t.name, t.name, JSON.stringify(t.steps), t.scope, JSON.stringify(t.branch));
}
console.log(`Seeded ${TEMPLATES.length} workflow templates`);

// ─── Skills, Skill Types, Agent-Skill mappings, Config ───
// Imported from seed-data.sql (exported from initialized database)
const skillCount = db.prepare('SELECT COUNT(*) as c FROM skills').get().c;
if (skillCount === 0) {
  console.log('Importing skills, skill_types, agent_skills, config from seed-data.sql...');
  const sql = readFileSync(join(__dirname, 'seed-data.sql'), 'utf-8');
  db.pragma('foreign_keys = OFF');
  db.exec(sql);
  db.pragma('foreign_keys = ON');
  const newCount = db.prepare('SELECT COUNT(*) as c FROM skills').get().c;
  console.log(`Imported ${newCount} skills`);
} else {
  console.log(`Skills already exist (${skillCount}), skipping import`);
}

console.log('Seed complete.');
