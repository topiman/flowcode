import express from 'express';
import cors from 'cors';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import projectsRouter from './routes/projects.js';
import messageRouter from './routes/message.js';
import workflowsRouter from './routes/workflows.js';
import agentsRouter from './routes/agents.js';
import templatesRouter from './routes/templates.js';
import skillsRouter from './routes/skills.js';
import conversationsRouter from './routes/conversations.js';
import commandsRouter from './routes/commands.js';
import { shutdown } from './services/claude.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3210;

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// Auto-seed on first run
const agentCount = db.prepare('SELECT COUNT(*) as c FROM agents').get();
if (agentCount.c === 0) {
  console.log('First run - seeding database...');
  await import('./seed.js');
}

// Startup recovery: in-progress steps keep their status and session_id
// so they can be resumed via --resume on next user interaction.
// No reset needed — executeStep handles session resumption automatically.

// API routes
app.use('/api/projects', projectsRouter);
app.use('/api/message', messageRouter);
app.use('/api/workflows', workflowsRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/skills', skillsRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/commands', commandsRouter);

// Serve uploaded images
app.use('/api/uploads', express.static('/tmp/workflow-uploads'));

// Serve frontend (production build)
const distDir = join(__dirname, '..', 'client', 'dist');
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('{*path}', (req, res) => res.sendFile(join(distDir, 'index.html')));
}

// Graceful shutdown: kill all persistent Claude processes
process.on('SIGTERM', () => { shutdown(); process.exit(0); });
process.on('SIGINT', () => { shutdown(); process.exit(0); });

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard: http://0.0.0.0:${PORT}`);
});
