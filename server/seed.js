import db from './db.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

// ─── Agents, Skills, Skill Types, Agent-Skill mappings, Config ───
// All imported from seed-data.sql (exported from initialized database)
const agentCount = db.prepare('SELECT COUNT(*) as c FROM agents').get().c;
if (agentCount === 0) {
  console.log('Importing agents, skills, skill_types, agent_skills, config from seed-data.sql...');
  const sql = readFileSync(join(__dirname, 'seed-data.sql'), 'utf-8');
  db.pragma('foreign_keys = OFF');
  db.exec(sql);
  db.pragma('foreign_keys = ON');
  const agents = db.prepare('SELECT COUNT(*) as c FROM agents').get().c;
  const skills = db.prepare('SELECT COUNT(*) as c FROM skills').get().c;
  console.log(`Imported ${agents} agents, ${skills} skills`);
} else {
  console.log(`Database already initialized (${agentCount} agents), skipping import`);
}

console.log('Seed complete.');
