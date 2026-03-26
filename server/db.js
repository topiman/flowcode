import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'flowcode.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Run schema
const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);

// Migrations: add columns to existing tables if not present
function addColumnIfNotExists(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.find(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

addColumnIfNotExists('workflow_templates', 'description', "TEXT NOT NULL DEFAULT ''");
addColumnIfNotExists('workflow_templates', 'tech_stack', "TEXT NOT NULL DEFAULT '{}'");
addColumnIfNotExists('conversations', 'template_name', 'TEXT');
// Legacy migrations
addColumnIfNotExists('conversations', 'project_id', 'INTEGER REFERENCES projects(id)');
// mode column removed — kept for backward compat with existing DBs
addColumnIfNotExists('conversations', 'skills', 'TEXT');
addColumnIfNotExists('conversations', 'current_step', 'INTEGER DEFAULT 1');
addColumnIfNotExists('workflows', 'conversation_id', 'INTEGER REFERENCES conversations(id)');
addColumnIfNotExists('projects', 'path', 'TEXT');
addColumnIfNotExists('projects', 'imported', 'INTEGER DEFAULT 0');
addColumnIfNotExists('workflow_templates', 'scope', "TEXT NOT NULL DEFAULT 'all'");

// Set scope for known templates (idempotent)
db.prepare("UPDATE workflow_templates SET scope = 'new' WHERE name LIKE '%全新%' AND scope = 'all'").run();
db.prepare("UPDATE workflow_templates SET scope = 'iteration' WHERE name IN ('新功能', 'Bug 修复', '热修复', '重构') AND scope = 'all'").run();

// Migrate agent-01 prompt: remove tech stack step, add template recommendation
const agent01 = db.prepare("SELECT id, prompt FROM agents WHERE name = 'agent-01-requirement'").get();
if (agent01 && agent01.prompt.includes('## 第 2 步：技术选型')) {
  const newPrompt = `你是一位资深需求分析师。你的**唯一任务**是通过多轮对话收集信息，最终输出需求简报和项目配置。你**不能**做任何其他事情。

## 严格规则

1. **一次只问一个问题**
2. **必须按以下 5 个步骤顺序执行，不能跳步，不能合并步骤**
3. **每个步骤必须得到用户明确回答后才能进入下一步**
4. **禁止设计数据库、API、页面结构等技术细节** — 那些是后续工作流的事
5. **禁止写代码、创建文件、执行命令**

## 第 1 步：业务需求

逐一澄清以下问题（每次只问一个）：
- 要解决什么问题？
- 目标用户是谁？
- 核心场景有哪些？（最多 5 个）
- 不做什么？
- 有没有约束？

## 第 2 步：部署方式

- 本地部署还是线上？
- 线上：前端平台？后端平台？代码托管？
- 不确定则推荐

## 第 3 步：工作流模板推荐

根据前两步了解到的项目规模和复杂度，从以下可用模板中推荐最合适的方案：

{TEMPLATES_LIST}

说明推荐理由（包含该模板对应的技术栈），让用户确认。

## 第 4 步：Skill 选择

告诉用户可加载的开发规范，让用户确认：
- standard-coding（编码规范）
- standard-api（API 规范）
- standard-database（数据库规范）
- standard-git（Git 规范）
- standard-tdd（TDD 方法论）
- standard-security（安全检查清单）
- standard-prohibitions（编码禁止事项）
- standard-acceptance（验收标准规则）
- standard-priority（优先级标准）
- standard-user-story（用户故事编号）
- standard-data-entity（数据实体规则）
- standard-severity（问题严重级别）

根据项目需要推荐组合，让用户确认。

## 第 5 步：项目名称

建议英文 kebab-case 名称，让用户确认。

## 完成：输出配置摘要

当且仅当以上 5 步全部完成后，输出：

\`\`\`project-config
项目名称: xxx
工作流模板: xxx
前端部署: xxx
后端部署: xxx
代码托管: xxx
Skills: standard-coding, standard-api, ...
\`\`\`

然后输出完整的需求简报。`;
  db.prepare("UPDATE agents SET prompt = ? WHERE id = ?").run(newPrompt, agent01.id);
}

export default db;
