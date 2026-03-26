/**
 * Chat command system.
 *
 * CLI commands are forwarded to the persistent Claude Code process via stdin.
 * App-level commands are handled by the server without touching CLI.
 * Client commands execute entirely in the browser.
 */

// Commands handled client-side (never hit the server)
export const CLIENT_COMMANDS = {
  '/clear': '清空聊天界面的消息显示',
  '/retry': '重新发送上一条消息',
  '/help': '显示可用命令列表',
};

// Commands handled at the app level (server, not forwarded to CLI)
export const APP_COMMANDS = {
  '/cancel': '终止运行中的进程',
  '/new': '清除 session + 杀进程，重新开始',
  '/status': '查看工作流/会话状态 + 持久进程信息',
};

// Commands forwarded to Claude Code CLI persistent process
export const CLI_COMMANDS = {
  '/context': '查看上下文 token 使用详情',
  '/cost': '查看当前会话费用',
  '/compact': '压缩上下文窗口',
  '/review': '代码审查',
  '/security-review': '安全审查',
  '/pr-comments': 'PR 评论',
  '/release-notes': '生成发布说明',
  '/insights': '代码洞察',
  '/init': '初始化 CLAUDE.md',
};

// All commands merged (for autocomplete)
export const COMMANDS = { ...CLIENT_COMMANDS, ...APP_COMMANDS, ...CLI_COMMANDS };

/**
 * Parse input text. Returns { command, args, scope, raw } or null.
 */
export function parseCommand(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;

  const parts = trimmed.split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');

  if (CLIENT_COMMANDS[command]) return { command, args, scope: 'client' };
  if (APP_COMMANDS[command]) return { command, args, scope: 'server' };
  if (CLI_COMMANDS[command]) return { command, args, scope: 'cli', raw: trimmed };

  // Unknown /xxx — try forwarding to CLI
  if (command.startsWith('/')) return { command, args, scope: 'cli', raw: trimmed };

  return null;
}

/**
 * Build the help text shown to users.
 */
export function buildHelpText() {
  const lines = ['可用命令：', ''];

  lines.push('── CLI 命令（透传到持久进程，需要活跃 session）──');
  for (const [cmd, desc] of Object.entries(CLI_COMMANDS)) {
    lines.push(`  ${cmd.padEnd(20)} ${desc}`);
  }

  lines.push('');
  lines.push('── 应用命令 ──');
  for (const [cmd, desc] of Object.entries(APP_COMMANDS)) {
    lines.push(`  ${cmd.padEnd(20)} ${desc}`);
  }

  lines.push('');
  lines.push('── 客户端命令 ──');
  for (const [cmd, desc] of Object.entries(CLIENT_COMMANDS)) {
    lines.push(`  ${cmd.padEnd(20)} ${desc}`);
  }

  lines.push('');
  lines.push('不支持: /model, /doctor, /memory, /login, /config（交互模式专属）');
  lines.push('其他 /xxx 也会尝试转发给 CLI。');
  return lines.join('\n');
}
