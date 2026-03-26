import { Router } from 'express';
import { execSync } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, symlinkSync, lstatSync, statSync } from 'fs';
import { join, basename } from 'path';
import db from '../db.js';
import { writeProjectFiles } from '../services/workflow-generator.js';
import { PROJECTS_DIR } from '../config.js';

const router = Router();

router.get('/', (req, res) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
  const workflows = db.prepare('SELECT id, project_id, status, current_step, feature_id, branch, template_id, created_at FROM workflows ORDER BY id DESC').all();
  const result = projects.map(p => {
    const pWorkflows = workflows.filter(w => w.project_id === p.id);
    const latest = pWorkflows[0];
    return {
      ...p,
      latest_status: latest?.status || null,
      current_step: latest?.current_step || null,
      workflow_id: latest?.id || null,
      workflows: pWorkflows,
    };
  });
  res.json(result);
});

router.get('/pick-folder', (req, res) => {
  try {
    const result = execSync(
      `osascript -e 'POSIX path of (choose folder with prompt "选择项目目录")'`,
      { timeout: 60000, encoding: 'utf-8' }
    ).trim().replace(/\/$/, '');
    res.json({ path: result });
  } catch {
    res.json({ path: '' });
  }
});

router.post('/import', (req, res) => {
  const { path: projectPath, name: rawName } = req.body;
  if (!projectPath) return res.status(400).json({ error: '缺少项目路径' });

  try {
    // Validate path exists and is a directory
    if (!existsSync(projectPath)) return res.status(400).json({ error: '路径不存在' });
    if (!statSync(projectPath).isDirectory()) return res.status(400).json({ error: '路径不是目录' });

    const name = (rawName || basename(projectPath)).trim();
    if (!name) return res.status(400).json({ error: '无法确定项目名称' });

    // Check duplicates
    if (db.prepare('SELECT id FROM projects WHERE name = ?').get(name)) {
      return res.status(400).json({ error: '项目名已存在' });
    }
    const symlinkPath = join(PROJECTS_DIR, name);
    if (existsSync(symlinkPath)) {
      return res.status(400).json({ error: 'projects 目录下已存在同名文件' });
    }

    // Auto git init if not a git repo
    if (!existsSync(join(projectPath, '.git'))) {
      execSync('git init && git add . && git commit -m "chore: initialize" --allow-empty', { cwd: projectPath });
    }

    // Ensure PROJECTS_DIR exists, then create symlink
    mkdirSync(PROJECTS_DIR, { recursive: true });
    symlinkSync(projectPath, symlinkPath);

    // Write .counter if not present
    const counterFile = join(symlinkPath, '.counter');
    if (!existsSync(counterFile)) {
      writeFileSync(counterFile, '0');
    }

    // DB record
    const row = db.prepare('INSERT INTO projects (name, path, imported) VALUES (?, ?, 1)').run(name, projectPath);
    res.json({ projectId: row.lastInsertRowid, name });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/', (req, res) => {
  const { name, description = '', conversationId, projectId, templateName } = req.body;
  if (!name) return res.status(400).json({ error: '缺少项目名' });

  try {
    let result;
    if (!projectId) {
      result = createNewProject(name, conversationId);
    } else {
      if (!description) return res.status(400).json({ error: '迭代模式需要描述' });
      result = createIteration(name, description, conversationId, templateName);
    }

    // Link conversation to project if provided
    if (conversationId) {
      db.prepare('UPDATE conversations SET status = ?, project_name = ? WHERE id = ?').run('confirmed', name, conversationId);
    }

    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

function createNewProject(name, conversationId) {
  const p = join(PROJECTS_DIR, name);
  if (existsSync(p)) throw new Error('项目已存在');

  // Resolve template — use template_name from conversation if available, else fallback
  let template;
  if (conversationId) {
    const conv = db.prepare('SELECT template_name FROM conversations WHERE id = ?').get(conversationId);
    if (conv?.template_name) template = db.prepare('SELECT * FROM workflow_templates WHERE name = ?').get(conv.template_name);
  }
  if (!template) template = db.prepare('SELECT * FROM workflow_templates LIMIT 1').get();

  // Write project files (CLAUDE.md + doc/tech directory)
  mkdirSync(p, { recursive: true });
  writeProjectFiles(p, template);

  // Write requirement brief from conversation
  if (conversationId) {
    const conv = db.prepare('SELECT requirement_brief FROM conversations WHERE id = ?').get(conversationId);
    if (conv?.requirement_brief) {
      mkdirSync(join(p, 'doc'), { recursive: true });
      writeFileSync(join(p, 'doc', 'requirement-brief.md'), conv.requirement_brief);
    }
  }

  // Fixed files
  writeFileSync(join(p, 'CHANGELOG.md'), `# Changelog\n\n## [Unreleased]\n\n### Added\n- 项目初始化\n`);
  writeFileSync(join(p, '.gitignore'), `node_modules/\n.env\n.env.local\ndist/\nbuild/\n.next/\ncoverage/\n.vscode/\n.idea/\n.DS_Store\n.workflow-state.json\n.workflow-config.json\n*.pem\n*.key\ncredentials.json\n`);
  writeFileSync(join(p, '.counter'), '1');

  // Git init
  execSync('git init && git add . && git commit -m "chore: initialize project" && git branch -M main', { cwd: p });

  // DB records
  const projectRow = db.prepare('INSERT INTO projects (name) VALUES (?)').run(name);
  const steps = JSON.parse(template.step_sequence);
  const flatSteps = steps.flatMap(s => Array.isArray(s) ? s : [s]);

  // Don't inherit conversation session - workflow creates its own (different cwd)
  const wfRow = db.prepare('INSERT INTO workflows (project_id, template_id, status, current_step, conversation_id) VALUES (?, ?, ?, ?, ?)')
    .run(projectRow.lastInsertRowid, template.id, 'in-progress', flatSteps[0], conversationId || null);

  const insertStep = db.prepare('INSERT INTO workflow_steps (workflow_id, step_name, sort_order) VALUES (?, ?, ?)');
  flatSteps.forEach((s, i) => insertStep.run(wfRow.lastInsertRowid, s, i));

  return { projectId: projectRow.lastInsertRowid, workflowId: wfRow.lastInsertRowid };
}

function toKebab(s) {
  const hasChinese = /[\u4e00-\u9fff]/.test(s);
  const limit = hasChinese ? 6 : 20;
  return s.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\u4e00-\u9fff-]/g, '').slice(0, limit);
}

function createIteration(name, description, conversationId, templateName) {
  const p = join(PROJECTS_DIR, name);
  if (!existsSync(p)) throw new Error('项目不存在');

  let project = db.prepare('SELECT * FROM projects WHERE name = ?').get(name);
  if (!project) {
    const r = db.prepare('INSERT INTO projects (name) VALUES (?)').run(name);
    project = { id: r.lastInsertRowid, name };
  }

  // Read branch config from template
  let template;
  if (templateName) {
    template = db.prepare('SELECT * FROM workflow_templates WHERE name = ?').get(templateName);
  }
  if (!template && conversationId) {
    const conv = db.prepare('SELECT template_name FROM conversations WHERE id = ?').get(conversationId);
    if (conv?.template_name) template = db.prepare('SELECT * FROM workflow_templates WHERE name = ?').get(conv.template_name);
  }
  if (!template) template = db.prepare('SELECT * FROM workflow_templates LIMIT 1').get();

  const branchConfig = (() => { try { return JSON.parse(template.branch_config); } catch { return {}; } })();
  const tplName = template.name || 'iteration';
  const baseBranch = branchConfig.base || 'main';
  const branchPrefix = branchConfig.prefix || tplName;
  const idPrefix = branchConfig.idPrefix || tplName.charAt(0).toUpperCase();
  const branchPattern = branchConfig.pattern || '{prefix}/{id}-{slug}';

  // Counter
  const cf = join(p, '.counter');
  let c = 0;
  try { c = parseInt(readFileSync(cf, 'utf-8')); } catch {}
  c++;
  writeFileSync(cf, String(c));
  const counter = String(c).padStart(3, '0');

  const slug = toKebab(description);
  const featureId = `${idPrefix}${counter}`;
  const branchName = branchPattern
    .replace('{prefix}', branchPrefix)
    .replace('{id}', featureId)
    .replace('{slug}', slug);
  const featureDir = `features/${featureId}-${slug}`;

  // Create git worktree for parallel development
  const worktreeDir = join(p, '..', `${name}--${featureId}`);
  execSync(`git worktree add -b ${branchName} ${JSON.stringify(worktreeDir)} ${baseBranch}`, { cwd: p });

  // Clean up inherited files/dirs that don't belong in a fresh iteration
  const cleanupFiles = [
    '.workflow-state.json', '.workflow-config.json',
    '.CLAUDE.md.bak', '.workflow.md.bak',
    'workflow.md', 'deploy-result.md', 'doc/review-report.md', 'review-report.md', 'e2e-report.md',
  ];
  for (const f of cleanupFiles) {
    try { unlinkSync(join(worktreeDir, f)); } catch {}
  }
  // Remove inherited dirs/files no longer needed (managed by backend)
  const cleanupDirs = ['agents', 'skills', 'doc/templates'];
  for (const d of cleanupDirs) {
    try { execSync(`rm -rf ${JSON.stringify(join(worktreeDir, d))}`, { stdio: 'ignore' }); } catch {}
  }

  // Feature dir + requirement brief in worktree
  mkdirSync(join(worktreeDir, featureDir), { recursive: true });
  if (conversationId) {
    const conv = db.prepare('SELECT requirement_brief FROM conversations WHERE id = ?').get(conversationId);
    if (conv?.requirement_brief) {
      writeFileSync(join(worktreeDir, featureDir, 'requirement-brief.md'), conv.requirement_brief);
    }
  } else if (description) {
    // Write user's description as the requirement brief
    writeFileSync(join(worktreeDir, featureDir, 'requirement-brief.md'), `# ${description}\n\n${description}\n`);
  }
  const clTpl = db.prepare("SELECT content FROM skills WHERE name = 'template-changelog'").get();
  if (clTpl) writeFileSync(join(worktreeDir, featureDir, 'changelog.md'), clTpl.content);

  // Project files in worktree
  const steps = JSON.parse(template.step_sequence);
  const flatSteps = steps.flatMap(s => Array.isArray(s) ? s : [s]);
  writeProjectFiles(worktreeDir, template);

  const wfRow = db.prepare('INSERT INTO workflows (project_id, template_id, feature_id, feature_dir, branch, worktree_dir, status, current_step, conversation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(project.id, template.id, featureId, featureDir, branchName, worktreeDir, 'in-progress', flatSteps[0], conversationId || null);

  const insertStep = db.prepare('INSERT INTO workflow_steps (workflow_id, step_name, sort_order) VALUES (?, ?, ?)');
  flatSteps.forEach((s, i) => insertStep.run(wfRow.lastInsertRowid, s, i));

  return { projectId: project.id, workflowId: wfRow.lastInsertRowid };
}

// Get all workflows for a project
router.get('/:id/workflows', (req, res) => {
  const workflows = db.prepare(`
    SELECT w.*, wt.name as template_name,
      (SELECT COUNT(*) FROM workflow_steps WHERE workflow_id = w.id) as total_steps,
      (SELECT COUNT(*) FROM workflow_steps WHERE workflow_id = w.id AND status = 'completed') as completed_steps
    FROM workflows w
    LEFT JOIN workflow_templates wt ON wt.id = w.template_id
    WHERE w.project_id = ?
    ORDER BY w.created_at DESC
  `).all(req.params.id);
  res.json(workflows);
});

// Delete project and all related data
router.delete('/:id', (req, res) => {
  const id = req.params.id;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!project) return res.status(404).json({ error: 'not found' });

  // Delete related DB records
  const workflows = db.prepare('SELECT id FROM workflows WHERE project_id = ?').all(id);
  for (const w of workflows) {
    db.prepare('DELETE FROM step_logs WHERE workflow_step_id IN (SELECT id FROM workflow_steps WHERE workflow_id = ?)').run(w.id);
    db.prepare('DELETE FROM workflow_steps WHERE workflow_id = ?').run(w.id);
    db.prepare('DELETE FROM chat_messages WHERE workflow_id = ?').run(w.id);
  }
  db.prepare('DELETE FROM workflows WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM chat_messages WHERE conversation_id IN (SELECT id FROM conversations WHERE project_id = ?)').run(id);
  db.prepare('DELETE FROM conversations WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);

  // Delete project directory or symlink
  const p = join(PROJECTS_DIR, project.name);
  let pathExists = false;
  try { lstatSync(p); pathExists = true; } catch {}
  if (pathExists) {
    if (project.imported) {
      // Imported project: only remove symlink, don't delete source
      try { unlinkSync(p); } catch {}
    } else {
      execSync(`rm -rf ${JSON.stringify(p)}`);
    }
  }

  res.json({ ok: true });
});

export default router;
