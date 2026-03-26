import db from './db.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const agentCount = db.prepare('SELECT COUNT(*) as c FROM agents').get().c;
if (agentCount === 0) {
  console.log('Importing seed data...');
  const sql = readFileSync(join(__dirname, 'seed-data.sql'), 'utf-8');
  db.pragma('foreign_keys = OFF');
  db.exec(sql);
  db.pragma('foreign_keys = ON');

  const agents = db.prepare('SELECT COUNT(*) as c FROM agents').get().c;
  const skills = db.prepare('SELECT COUNT(*) as c FROM skills').get().c;
  const templates = db.prepare('SELECT COUNT(*) as c FROM workflow_templates').get().c;
  console.log(`Imported: ${agents} agents, ${skills} skills, ${templates} templates`);
} else {
  console.log(`Database already initialized (${agentCount} agents), skipping`);
}

console.log('Seed complete.');
