import { join } from 'path';
import db from '../db.js';
import { broadcast } from './sse.js';
import { PROJECTS_DIR } from '../config.js';
import { sendMessage, killProcess } from './claude-process.js';

// ─── Send message in conversation (pre-project, requirement gathering) ───
export async function sendConversationMessage(convId, message, displayMessage) {
  console.log(`[conversation] conv=${convId} msg=${message.slice(0, 60)}`);
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId);
  if (!conv) throw new Error('Conversation not found');
  console.log(`[conversation] status=${conv.status} session=${conv.session_id?.slice(0, 8) || 'none'} project_id=${conv.project_id || 'none'}`);

  const broadcastKey = `conv:${convId}`;

  // Save user message (display version without inlined file content)
  const userDisplay = displayMessage || message;
  db.prepare('INSERT INTO chat_messages (conversation_id, role, content) VALUES (?, ?, ?)').run(convId, 'user', userDisplay);
  broadcast(broadcastKey, 'chat-message', { role: 'user', content: userDisplay });

  // Load conversation prompt from config → skill
  const configKey = conv.project_id ? 'conversation_prompt_iteration' : 'conversation_prompt_new';
  const configRow = db.prepare('SELECT value FROM config WHERE key = ?').get(configKey);
  const skillName = configRow?.value || 'conversation-prompt-new';
  const skill = db.prepare('SELECT content FROM skills WHERE name = ?').get(skillName);
  let systemPrompt = skill?.content || '';

  // Conversation always runs from /tmp to avoid loading project's CLAUDE.md
  let cwd = '/tmp';
  if (conv.project_id) {
    const project = db.prepare('SELECT name FROM projects WHERE id = ?').get(conv.project_id);
    if (project) {
      const projectDir = join(PROJECTS_DIR, project.name);
      systemPrompt = systemPrompt.replace('{PROJECT_DIR}', projectDir);
    }
  }

  // Inject available templates into prompt placeholder (filtered by scope)
  const scope = conv.project_id ? 'iteration' : 'new';
  const templates = db.prepare("SELECT name, description, tech_stack FROM workflow_templates WHERE scope = ? OR scope = 'all' ORDER BY id").all(scope);
  const templatesList = templates.map(t => {
    const ts = (() => { try { return JSON.parse(t.tech_stack); } catch { return {}; } })();
    const techStr = [ts.frontend, ts.backend, ts.database].filter(Boolean).join(' + ');
    return `- **${t.name}**${t.description ? ': ' + t.description : ''}${techStr ? `（${techStr}）` : ''}`;
  }).join('\n');
  systemPrompt = systemPrompt.replace('{TEMPLATES_LIST}', templatesList || '（暂无可用模板，请先在工作流模板管理中创建）');

  const blockedTools = ['Bash', 'Write', 'Edit', 'Glob', 'Grep', 'NotebookEdit', 'TodoWrite', 'Agent', 'Task', 'ToolSearch', 'SendMessage'];

  let result;
  if (conv.session_id) {
    // Resume: persistent process may still be alive, or will be recreated with --resume
    console.log(`[conversation] resuming session ${conv.session_id.slice(0, 8)}`);
    try {
      result = await sendMessage(broadcastKey, message, {
        cwd,
        sessionId: conv.session_id,
        broadcastKey,
        disallowedTools: blockedTools,
      });
    } catch (err) {
      console.log(`[conversation] persistent process failed, retrying: ${err.message}`);
      result = null;
    }

    if (!result || !result.output) {
      console.log(`[conversation] resume failed, starting new session for conv ${convId}`);
      db.prepare('UPDATE conversations SET session_id = NULL WHERE id = ?').run(convId);
      killProcess(broadcastKey);

      // Fallback: rebuild context with instructions + history
      const history = db.prepare('SELECT role, content FROM chat_messages WHERE conversation_id = ? ORDER BY created_at').all(convId);
      const historySummary = history.map(m => `${m.role === 'user' ? '用户' : '你'}: ${m.content.slice(0, 300)}`).join('\n\n');
      const fallbackMessage = `${systemPrompt}\n\n## 之前的对话记录\n\n${historySummary}\n\n用户说：${message}`;

      result = await sendMessage(broadcastKey, fallbackMessage, {
        cwd,
        broadcastKey,
        disallowedTools: blockedTools,
      });
    }
  } else {
    // First message: put instructions in the message itself (not --system-prompt)
    console.log(`[conversation] new session for conv ${convId}`);
    const firstMessage = `${systemPrompt}\n\n用户说：${message}`;
    result = await sendMessage(broadcastKey, firstMessage, {
      cwd,
      broadcastKey,
      disallowedTools: blockedTools,
    });
  }

  console.log(`[conversation] done: session=${result.sessionId?.slice(0, 8) || 'none'} output=${result.output?.length || 0} chars`);

  // Save session ID
  if (result.sessionId) {
    db.prepare('UPDATE conversations SET session_id = ? WHERE id = ?').run(result.sessionId, convId);
  }

  // Parse project-config block from assistant output
  if (result.output) {
    const configMatch = result.output.match(/```project-config\n([\s\S]*?)```/);
    if (configMatch) {
      const config = {};
      for (const line of configMatch[1].trim().split('\n')) {
        const [key, ...vals] = line.split(':');
        if (key && vals.length) config[key.trim()] = vals.join(':').trim();
      }
      const updates = {};
      if (config['项目名称']) updates.project_name = config['项目名称'];
      if (config['工作流模板']) {
        const rawName = config['工作流模板'];
        let tmpl = db.prepare('SELECT name, tech_stack FROM workflow_templates WHERE name = ?').get(rawName);
        if (!tmpl) {
          const allTemplates = db.prepare('SELECT name, tech_stack FROM workflow_templates ORDER BY id').all();
          tmpl = allTemplates.find(t => rawName.includes(t.name));
        }
        updates.template_name = tmpl?.name || rawName;
        if (tmpl?.tech_stack) updates.tech_stack = tmpl.tech_stack;
      }

      const briefMatch = result.output.match(/```project-config[\s\S]*?```\s*([\s\S]*?)(?:配置和需求简报已整理完成|$)/);
      if (briefMatch && briefMatch[1].trim()) {
        updates.requirement_brief = briefMatch[1].trim();
      }

      for (const [k, v] of Object.entries(updates)) {
        db.prepare(`UPDATE conversations SET ${k} = ? WHERE id = ?`).run(v, convId);
      }
      broadcast(broadcastKey, 'config-parsed', updates);
    }
  }

  // Save assistant message
  if (result.output) {
    db.prepare('INSERT INTO chat_messages (conversation_id, role, content) VALUES (?, ?, ?)').run(convId, 'assistant', result.output);
    broadcast(broadcastKey, 'chat-message', { role: 'assistant', content: result.output });
  }

  return result;
}
