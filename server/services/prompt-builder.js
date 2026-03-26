import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import db from '../db.js';

export function buildAgentPrompt(agent, cwd) {
  let prompt = `## 重要规则

你是直接执行任务的 agent，不是编排者。
- 直接完成你的任务（读文件、写代码、跑测试等）
- 禁止使用 Agent 工具派发 subagent
- 禁止读取 .workflow-state.json、.workflow-config.json、workflow.md、CLAUDE.md
- 禁止更新工作流状态
- 所有需要的输入文件已在下方提供，无需自行查找配置文件

## 你的任务

` + (agent.prompt || '');

  // Inline input files content so agent doesn't need to read them
  let inputs = [];
  try { inputs = JSON.parse(agent.inputs || '[]'); } catch {}
  if (inputs.length > 0 && cwd) {
    prompt += '\n\n## 输入文件内容\n\n以下是你需要的输入文件，已提前读取：\n';
    for (const inp of inputs) {
      const filePath = join(cwd, inp);
      try {
        if (existsSync(filePath)) {
          const content = readFileSync(filePath, 'utf-8');
          prompt += `\n### ${inp}\n\n\`\`\`\n${content}\n\`\`\`\n`;
        }
      } catch {}
    }
  }

  // Inline output file paths
  let outputs = [];
  try { outputs = JSON.parse(agent.outputs || '[]'); } catch {}
  if (outputs.length > 0) {
    prompt += '\n\n## 输出文件\n\n请将结果写入以下文件：\n';
    for (const out of outputs) prompt += `- \`${out}\`\n`;
  }

  // Append linked skills
  const skills = db.prepare(`
    SELECT s.name, s.content, st.label as type_label, st.instruction as type_instruction
    FROM agent_skills ags
    JOIN skills s ON s.id = ags.skill_id
    LEFT JOIN skill_types st ON st.name = s.type
    WHERE ags.agent_id = ? ORDER BY ags.sort_order
  `).all(agent.id);

  if (skills.length > 0) {
    const grouped = {};
    for (const s of skills) {
      const key = s.type_label || '参考';
      if (!grouped[key]) grouped[key] = { instruction: s.type_instruction || '', skills: [] };
      grouped[key].skills.push(s);
    }
    for (const [label, group] of Object.entries(grouped)) {
      prompt += `\n\n## ${label}\n\n${group.instruction}\n`;
      for (const s of group.skills) {
        prompt += `\n### ${s.name}\n\n${s.content}\n`;
      }
    }
  }

  return prompt;
}

export function buildHistorySummary(workflowId, convId) {
  const messages = db.prepare(
    'SELECT role, content FROM chat_messages WHERE workflow_id = ? OR conversation_id = ? ORDER BY created_at'
  ).all(workflowId, convId || -1);
  if (messages.length === 0) return '';
  const recent = messages.slice(-20);
  return recent.map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.content.slice(0, 300)}`).join('\n\n');
}
