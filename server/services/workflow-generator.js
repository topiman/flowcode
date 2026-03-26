import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * Write minimal project files for a new project/iteration.
 * Agent prompts and skills are passed via --system-prompt at runtime, not written to disk.
 */
export function writeProjectFiles(projectDir, template) {
  // doc/ output directories
  mkdirSync(join(projectDir, 'doc', 'tech'), { recursive: true });

  // CLAUDE.md (project info only)
  const ts = (() => { try { return JSON.parse(template.tech_stack); } catch { return {}; } })();
  const techParts = [ts.frontend, ts.backend, ts.database].filter(Boolean);
  const techLine = techParts.length > 0 ? techParts.join(' + ') : '（未指定）';

  writeFileSync(join(projectDir, 'CLAUDE.md'), `# 项目说明

## 技术栈

${techLine}

## 项目约定

（在此添加项目特有的编码约定、命名规范、团队约定等）
`);
}
