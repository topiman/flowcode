import { spawn } from 'child_process';
import db from '../db.js';
import { broadcast } from './sse.js';

// ─── Configuration ───
const MAX_POOL_SIZE = 10;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const SPAWN_TIMEOUT_MS = 60000; // 60s for first output

// ─── Process Pool ───
const pool = new Map(); // key -> PersistentProcess
const autoModeRunning = new Set();
const subagentDepth = new Map();

export { autoModeRunning };

// ─── PersistentProcess class ───

class PersistentProcess {
  constructor(key, broadcastKey, proc, options = {}) {
    this.key = key;
    this.broadcastKey = broadcastKey;
    this.proc = proc;
    this.sessionId = options.sessionId || null;
    this.state = 'idle'; // idle | busy | dead
    this.idleSince = Date.now();
    this.buffer = '';
    this.pendingResolve = null;
    this.pendingReject = null;
    this.resultText = '';
    this.queue = [];
    this.gotOutput = false;
    this.spawnTimeout = null;

    // Cumulative session stats
    this.stats = { costUsd: 0, durationMs: 0, durationApiMs: 0, turns: 0, usage: {}, modelUsage: {} };
    this.initInfo = null; // { model, sessionId, version, tools, slashCommands }

    this._setupListeners();
  }

  _setupListeners() {
    // Timeout for initial output (stuck --resume detection)
    this.spawnTimeout = setTimeout(() => {
      if (!this.gotOutput) {
        console.log(`[pool] spawn timeout for ${this.key}, killing`);
        this.proc.kill('SIGTERM');
      }
    }, SPAWN_TIMEOUT_MS);

    this.proc.stdout.on('data', chunk => {
      this.gotOutput = true;
      if (this.spawnTimeout) { clearTimeout(this.spawnTimeout); this.spawnTimeout = null; }

      this.buffer += chunk.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          this._handleEvent(evt);
        } catch {
          broadcast(this.broadcastKey, 'log', { text: line + '\n' });
        }
      }
    });

    this.proc.stderr.on('data', chunk => {
      const text = chunk.toString();
      console.error(`[pool] stderr [${this.key}]:`, text.trim());
      broadcast(this.broadcastKey, 'log', { text, stderr: true });
    });

    this.proc.on('close', code => {
      if (this.spawnTimeout) { clearTimeout(this.spawnTimeout); this.spawnTimeout = null; }

      // Process remaining buffer
      if (this.buffer.trim()) {
        try {
          const evt = JSON.parse(this.buffer);
          this._handleEvent(evt);
        } catch {}
      }

      console.log(`[pool] process exited [${this.key}]: code=${code}, session=${this.sessionId?.slice(0, 8)}`);
      this.state = 'dead';
      pool.delete(this.key);

      if (this.pendingResolve) {
        // Process died while handling a message — resolve with what we have
        const resolve = this.pendingResolve;
        this.pendingResolve = null;
        this.pendingReject = null;
        broadcast(this.broadcastKey, 'stream-end', {});
        resolve({ code, output: this.resultText, sessionId: this.sessionId });
      }
    });

    this.proc.on('error', err => {
      console.error(`[pool] process error [${this.key}]:`, err.message);
      this.state = 'dead';
      pool.delete(this.key);

      if (this.pendingReject) {
        const reject = this.pendingReject;
        this.pendingResolve = null;
        this.pendingReject = null;
        reject(err);
      }
    });
  }

  _handleEvent(evt) {
    // Extract session_id from system init or result
    if (evt.type === 'system' && evt.session_id) {
      this.sessionId = evt.session_id;
    }

    // Store init info
    if (evt.type === 'system' && evt.subtype === 'init') {
      console.log(`[claude] [${this.key}] init: model=${evt.model} session=${evt.session_id?.slice(0, 8)} version=${evt.claude_code_version}`);
      this.initInfo = {
        model: evt.model || '',
        sessionId: evt.session_id || '',
        version: evt.claude_code_version || '',
        tools: evt.tools || [],
        slashCommands: evt.slash_commands || [],
      };
    }

    // Log key event types
    if (evt.type === 'assistant' && evt.message?.content) {
      for (const block of evt.message.content) {
        if (block.type === 'tool_use') {
          console.log(`[claude] [${this.key}] tool_use: ${block.name} ${typeof block.input === 'string' ? block.input.slice(0, 80) : JSON.stringify(block.input).slice(0, 80)}`);
        }
      }
    }
    if (evt.type === 'tool_use') {
      console.log(`[claude] [${this.key}] tool_use: ${evt.name || evt.tool}`);
    }

    // Process event for SSE broadcast / logging
    processEvent(this.broadcastKey, evt);

    if (evt.type === 'result') {
      console.log(`[claude] [${this.key}] result: cost=$${(evt.total_cost_usd || 0).toFixed(4)} duration=${evt.duration_ms || 0}ms turns=${evt.num_turns || 0} output=${(evt.result || '').length} chars`);
      // Accumulate stats
      this.stats.costUsd += evt.total_cost_usd || 0;
      this.stats.durationMs += evt.duration_ms || 0;
      this.stats.durationApiMs += evt.duration_api_ms || 0;
      this.stats.turns += evt.num_turns || 0;
      this.stats.usage = evt.usage || this.stats.usage;
      this.stats.modelUsage = evt.modelUsage || this.stats.modelUsage;
      this.resultText = evt.result || '';
      if (evt.session_id) this.sessionId = evt.session_id;

      // Turn complete — resolve the pending promise
      if (this.pendingResolve) {
        const resolve = this.pendingResolve;
        this.pendingResolve = null;
        this.pendingReject = null;
        broadcast(this.broadcastKey, 'stream-end', {});
        resolve({ code: 0, output: this.resultText, sessionId: this.sessionId });
      }

      // Transition to idle
      this.state = 'idle';
      this.idleSince = Date.now();
      this.resultText = '';

      // Dequeue next message if any
      if (this.queue.length > 0) {
        console.log(`[claude] [${this.key}] dequeue: ${this.queue.length} remaining`);
        const { message, resolve, reject } = this.queue.shift();
        this._doSend(message, resolve, reject);
      }
    }
  }

  /**
   * Send a user message. Returns a promise that resolves when the result event arrives.
   */
  send(message) {
    return new Promise((resolve, reject) => {
      if (this.state === 'dead') {
        console.log(`[claude] [${this.key}] send rejected: process is dead`);
        return reject(new Error('Process is dead'));
      }
      if (this.state === 'busy') {
        console.log(`[claude] [${this.key}] send queued (queue=${this.queue.length + 1}): ${message.slice(0, 60)}`);
        this.queue.push({ message, resolve, reject });
        return;
      }
      this._doSend(message, resolve, reject);
    });
  }

  _doSend(message, resolve, reject) {
    this.state = 'busy';
    this.resultText = '';
    this.pendingResolve = resolve;
    this.pendingReject = reject;

    console.log(`[claude] [${this.key}] sending: ${message.slice(0, 80)}...`);
    const payload = JSON.stringify({ type: 'user', message: { role: 'user', content: message } });
    this.proc.stdin.write(payload + '\n');
  }

  kill() {
    if (this.state === 'dead') return;
    this.proc.kill('SIGTERM');
    // close handler will clean up
  }
}

// ─── Pool Management ───

/**
 * Get an existing alive process or create a new one.
 * If a process exists but options differ (e.g. different allowedTools), kill it and create new.
 */
export function getOrCreateProcess(key, options = {}) {
  const { cwd, sessionId, broadcastKey, disallowedTools, allowedTools, systemPrompt, agentMode, model } = options;
  const bKey = broadcastKey || key;

  const existing = pool.get(key);
  if (existing && existing.state !== 'dead') {
    // If model changed, kill old process and create new one
    if (model && existing.model !== model) {
      console.log(`[pool] model changed for [${key}]: ${existing.model} → ${model}, killing`);
      existing.proc.kill('SIGTERM');
      pool.delete(key);
    // If sessionId changed, kill old process and create new one (e.g. after rollback)
    } else if (sessionId && existing.sessionId !== sessionId) {
      console.log(`[pool] session changed for [${key}]: ${existing.sessionId?.slice(0, 8)} → ${sessionId?.slice(0, 8)}, killing`);
      existing.proc.kill('SIGTERM');
      pool.delete(key);
    } else {
      console.log(`[pool] reuse [${key}] state=${existing.state} session=${existing.sessionId?.slice(0, 8) || 'none'} model=${existing.model || 'default'}`);
      return existing;
    }
  }

  // Evict idle processes if at capacity
  if (pool.size >= MAX_POOL_SIZE) {
    evictIdlest();
  }

  // Spawn new persistent process
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions', '--include-partial-messages'];
  if (model) args.push('--model', model);
  if (sessionId) args.push('--resume', sessionId);
  if (systemPrompt) args.push('--system-prompt', systemPrompt);
  if (agentMode) args.push('--append-system-prompt', '重要：忽略项目目录下的 CLAUDE.md 和 workflow.md 文件，只遵循 system prompt 中的指令。');
  if (allowedTools) args.push('--allowedTools', allowedTools.length > 0 ? allowedTools.join(',') : '""');
  else if (disallowedTools) args.push('--disallowedTools', disallowedTools.join(' '));

  console.log(`[pool] spawn [${key}] cwd=${cwd || '/tmp'} model=${model || 'default'} resume=${sessionId?.slice(0, 8) || 'none'}`);
  const proc = spawn('claude', args, { cwd: cwd || '/tmp', env: { ...process.env } });
  const pp = new PersistentProcess(key, bKey, proc, { sessionId });
  pp.model = model || null;
  pool.set(key, pp);
  return pp;
}

function evictIdlest() {
  let oldest = null;
  let oldestTime = Infinity;
  for (const [key, pp] of pool) {
    if (pp.state === 'idle' && pp.idleSince < oldestTime) {
      oldest = key;
      oldestTime = pp.idleSince;
    }
  }
  if (oldest) {
    console.log(`[pool] evicting idle process [${oldest}]`);
    const pp = pool.get(oldest);
    pp.kill();
    pool.delete(oldest);
  }
}

// ─── Public API ───

/**
 * Send a message to a persistent process. Creates one if needed.
 * Compatible return type with old runClaudeStream: { code, output, sessionId }
 */
export async function sendMessage(key, message, options = {}) {
  const pp = getOrCreateProcess(key, options);
  return pp.send(message);
}

/**
 * Send a slash command (e.g. /context, /cost, /compact) to a persistent process.
 * Returns the result text.
 */
export async function sendCommand(key, command, options = {}) {
  const pp = getOrCreateProcess(key, options);
  const result = await pp.send(command);
  return result.output;
}

export function isRunning(key) {
  const pp = pool.get(key);
  return pp?.state === 'busy';
}

export function isAlive(key) {
  const pp = pool.get(key);
  return pp != null && pp.state !== 'dead';
}

export function getSessionId(key) {
  return pool.get(key)?.sessionId;
}

export function cancelRun(key) {
  const pp = pool.get(key);
  if (pp) {
    // Use SIGKILL for immediate termination (user explicitly cancelled)
    if (pp.state !== 'dead') pp.proc.kill('SIGKILL');
    pool.delete(key);
  }
}

export function killProcess(key) {
  const pp = pool.get(key);
  if (pp) {
    pp.kill();
    pool.delete(key);
  }
}

export function getProcessInfo(key) {
  const pp = pool.get(key);
  if (!pp) return null;
  return {
    pid: pp.proc.pid,
    sessionId: pp.sessionId,
    state: pp.state,
    idleSince: pp.idleSince,
    queueLength: pp.queue.length,
    stats: pp.stats,
    initInfo: pp.initInfo,
  };
}

export function shutdown() {
  console.log(`[pool] shutting down ${pool.size} processes`);
  for (const [key, pp] of pool) {
    pp.kill();
  }
  pool.clear();
}

// ─── Idle Timeout Scanner ───
const idleScanner = setInterval(() => {
  const now = Date.now();
  for (const [key, pp] of pool) {
    if (pp.state === 'idle' && (now - pp.idleSince) > IDLE_TIMEOUT_MS) {
      console.log(`[pool] idle timeout [${key}], killing`);
      pp.kill();
      pool.delete(key);
    }
  }
}, 60000);
idleScanner.unref(); // Don't prevent process exit

// ─── Legacy API (kept for compatibility during migration) ───
export { autoModeRunning as _autoModeRunning };

// Legacy runClaudeStream — spawn-per-message, used as fallback
export function runClaudeStreamLegacy(workflowId, message, cwd, sessionId, systemPrompt = null, disallowedTools = null, agentMode = false, allowedTools = null) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--dangerously-skip-permissions', '--verbose', '--output-format', 'stream-json', '--include-partial-messages'];
    if (sessionId) args.push('--resume', sessionId);
    if (systemPrompt) args.push('--system-prompt', systemPrompt);
    if (agentMode) args.push('--append-system-prompt', '重要：忽略项目目录下的 CLAUDE.md 和 workflow.md 文件，只遵循 system prompt 中的指令。');
    if (allowedTools) args.push('--allowedTools', allowedTools.length > 0 ? allowedTools.join(',') : '""');
    else if (disallowedTools) args.push('--disallowedTools', disallowedTools.join(' '));

    const proc = spawn('claude', args, { cwd, env: { ...process.env } });
    let resultText = '';
    let sid = null;
    let buffer = '';

    proc.stdin.write(message);
    proc.stdin.end();

    proc.stdout.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.type === 'system' && evt.session_id) sid = evt.session_id;
          processEvent(workflowId, evt);
          if (evt.type === 'result') { resultText = evt.result || ''; if (evt.session_id) sid = evt.session_id; }
        } catch {}
      }
    });

    proc.stderr.on('data', () => {});
    proc.on('close', code => {
      if (buffer.trim()) {
        try {
          const evt = JSON.parse(buffer);
          processEvent(workflowId, evt);
          if (evt.type === 'result') { resultText = evt.result || ''; if (evt.session_id) sid = evt.session_id; }
        } catch {}
      }
      broadcast(workflowId, 'stream-end', {});
      resolve({ code, output: resultText, sessionId: sid });
    });
    proc.on('error', reject);
  });
}

// ─── Event Processing (unchanged) ───

function getCurrentStepId(workflowId) {
  const wf = db.prepare('SELECT current_step FROM workflows WHERE id = ?').get(workflowId);
  if (!wf?.current_step) return null;
  const step = db.prepare('SELECT id FROM workflow_steps WHERE workflow_id = ? AND step_name = ?').get(workflowId, wf.current_step);
  return step?.id || null;
}

function appendLog(workflowId, text) {
  const stepId = getCurrentStepId(workflowId);
  if (stepId) {
    db.prepare('INSERT INTO step_logs (workflow_step_id, content) VALUES (?, ?)').run(stepId, text);
  }
}

function isInSubagent(workflowId) {
  return (subagentDepth.get(workflowId) || 0) > 0;
}

function enterSubagent(workflowId, info) {
  const depth = (subagentDepth.get(workflowId) || 0) + 1;
  subagentDepth.set(workflowId, depth);
  if (depth === 1) {
    broadcast(workflowId, 'subagent-start', info);
  }
}

function exitSubagent(workflowId) {
  const depth = (subagentDepth.get(workflowId) || 0) - 1;
  subagentDepth.set(workflowId, Math.max(0, depth));
  if (depth <= 0) {
    broadcast(workflowId, 'subagent-end', {});
  }
}

function extractAgentInfo(input) {
  const info = { description: '', model: '' };
  if (!input) return info;
  if (typeof input === 'object') {
    info.description = input.description || '';
    info.model = input.model || '';
  } else if (typeof input === 'string') {
    const dm = input.match(/"description"\s*:\s*"([^"]+)"/);
    if (dm) info.description = dm[1];
    const mm = input.match(/"model"\s*:\s*"([^"]+)"/);
    if (mm) info.model = mm[1];
  }
  return info;
}

function processEvent(workflowId, evt) {
  // Handle stream_event wrapper from --include-partial-messages
  if (evt.type === 'stream_event') {
    const inner = evt.event;
    if (!inner) return;
    if (inner.type === 'content_block_delta') {
      const d = inner.delta;
      if (d?.type === 'thinking_delta' && d.thinking) {
        broadcast(workflowId, 'thinking', { text: d.thinking, subagent: isInSubagent(workflowId) });
      } else if (d?.type === 'text_delta' && d.text) {
        broadcast(workflowId, 'text', { text: d.text, subagent: isInSubagent(workflowId) });
      }
    } else if (inner.type === 'content_block_start') {
      const block = inner.content_block;
      if (block?.type === 'tool_use') {
        if (block.name === 'Agent') {
          appendLog(workflowId, `[tool] Agent\n`);
        } else {
          broadcast(workflowId, 'tool', { tool: block.name, input: '', subagent: isInSubagent(workflowId) });
          appendLog(workflowId, `[tool] ${block.name}\n`);
        }
      }
    }
    return;
  }

  if (evt.type === 'assistant' && evt.message?.content) {
    for (const block of evt.message.content) {
      if (block.type === 'thinking' && block.thinking) {
        appendLog(workflowId, `[thinking] ${block.thinking}\n`);
      } else if (block.type === 'text' && block.text) {
        appendLog(workflowId, block.text);
      } else if (block.type === 'tool_use') {
        if (block.name === 'Agent') {
          const info = extractAgentInfo(block.input);
          enterSubagent(workflowId, info);
          appendLog(workflowId, `[subagent-start] ${info.description} (${info.model || 'default'})\n`);
        } else {
          broadcast(workflowId, 'tool', { tool: block.name, input: summarize(block.input), subagent: isInSubagent(workflowId) });
          appendLog(workflowId, `[tool] ${block.name}: ${summarize(block.input)}\n`);
        }
      } else if (block.type === 'tool_result') {
        if (isInSubagent(workflowId)) {
          exitSubagent(workflowId);
          appendLog(workflowId, `[subagent-end]\n`);
        }
      }
    }
  }
  if (evt.type === 'content_block_delta') {
    const d = evt.delta;
    if (d?.type === 'thinking_delta' && d.thinking) { broadcast(workflowId, 'thinking', { text: d.thinking, subagent: isInSubagent(workflowId) }); }
    else if (d?.type === 'text_delta' && d.text) { broadcast(workflowId, 'text', { text: d.text, subagent: isInSubagent(workflowId) }); }
  }
  if (evt.type === 'tool_use') {
    const name = evt.name || evt.tool;
    if (name === 'Agent') {
      const info = extractAgentInfo(evt.input);
      enterSubagent(workflowId, info);
      appendLog(workflowId, `[subagent-start] ${info.description} (${info.model || 'default'})\n`);
    } else {
      broadcast(workflowId, 'tool', { tool: name, input: summarize(evt.input), subagent: isInSubagent(workflowId) });
      appendLog(workflowId, `[tool] ${name}: ${summarize(evt.input)}\n`);
    }
  }
  if (evt.type === 'assistant' && evt.message?.model) {
    broadcast(workflowId, 'model-info', { model: evt.message.model });
  }
  if (evt.type === 'rate_limit_event' && evt.rate_limit_info) {
    console.log(`[claude] [${workflowId}] rate-limit: ${JSON.stringify(evt.rate_limit_info)}`);
    broadcast(workflowId, 'rate-limit', evt.rate_limit_info);
  }
  if (evt.type === 'result') {
    if (isInSubagent(workflowId)) {
      subagentDepth.set(workflowId, 0);
      broadcast(workflowId, 'subagent-end', {});
    }
    broadcast(workflowId, 'result', { text: evt.result || '' });
    appendLog(workflowId, `\n[result] duration=${evt.duration_ms || 0}ms\n`);

    // Broadcast session stats from result event
    broadcast(workflowId, 'session-stats', {
      costUsd: evt.total_cost_usd || 0,
      durationMs: evt.duration_ms || 0,
      durationApiMs: evt.duration_api_ms || 0,
      turns: evt.num_turns || 0,
      usage: evt.usage || {},
      modelUsage: evt.modelUsage || {},
    });
  }
  // Extract stats from system.init event
  if (evt.type === 'system' && evt.subtype === 'init') {
    broadcast(workflowId, 'session-init', {
      model: evt.model || '',
      sessionId: evt.session_id || '',
      tools: evt.tools || [],
      slashCommands: evt.slash_commands || [],
      version: evt.claude_code_version || '',
    });
  }
}

function summarize(input) {
  if (!input) return '';
  if (typeof input === 'string') return input.slice(0, 120);
  return (input.file_path || input.command || input.pattern || input.query || JSON.stringify(input)).slice(0, 120);
}
