import { useEffect, useRef, useState } from 'react';

// Shorten absolute paths for display
function shortenPath(str) {
  if (!str) return '';
  return str.replace(/\/Users\/[^/]+\/Documents\/workflow\/projects\/[^/]+\//g, './');
}

// Tool type icons & colors
const TOOL_STYLE = {
  Read:    { icon: '📄', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' },
  Glob:   { icon: '🔍', color: 'text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/20' },
  Grep:   { icon: '🔎', color: 'text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/20' },
  Write:  { icon: '✏️', color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/20' },
  Edit:   { icon: '✏️', color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/20' },
  Bash:   { icon: '⚡', color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20' },
  Agent:  { icon: '🤖', color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20' },
};
const DEFAULT_STYLE = { icon: '⚙️', color: 'text-gray-400', bg: 'bg-gray-500/10 border-gray-500/20' };

const SOURCE_BADGE = {
  main: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  sub: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
};

function ToolEntry({ tool, input, source }) {
  const [expanded, setExpanded] = useState(false);
  const style = TOOL_STYLE[tool] || DEFAULT_STYLE;
  const shortInput = shortenPath(input);
  const isLong = shortInput.length > 80;

  return (
    <div
      className={`flex items-start gap-2 px-2.5 py-1.5 my-0.5 rounded-md border ${style.bg} cursor-pointer hover:brightness-125 transition-all`}
      onClick={() => isLong && setExpanded(!expanded)}
    >
      {source && <span className={`text-[9px] px-1 py-0.5 rounded border shrink-0 ${SOURCE_BADGE[source] || ''}`}>{source === 'main' ? '主' : 'Sub'}</span>}
      <span className="shrink-0 text-xs mt-px">{style.icon}</span>
      <span className={`text-[11px] font-semibold shrink-0 ${style.color}`}>{tool}</span>
      <span className="text-[11px] text-gray-400 min-w-0 break-all">
        {expanded ? shortInput : (isLong ? shortInput.slice(0, 80) + '…' : shortInput)}
      </span>
      {isLong && (
        <span className="text-[10px] text-gray-600 shrink-0 ml-auto">{expanded ? '▼' : '▶'}</span>
      )}
    </div>
  );
}

function ThinkingBlock({ text }) {
  const [expanded, setExpanded] = useState(false);
  const preview = text.slice(0, 120).replace(/\n/g, ' ');
  const isLong = text.length > 120;

  return (
    <div
      className="my-0.5 px-2.5 py-1.5 rounded-md bg-purple-500/5 border border-purple-500/10 cursor-pointer hover:bg-purple-500/10 transition-all"
      onClick={() => isLong && setExpanded(!expanded)}
    >
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-purple-500 font-semibold uppercase tracking-wide shrink-0">Thinking</span>
        {isLong && <span className="text-[10px] text-gray-600 ml-auto">{expanded ? '▼' : '▶'}</span>}
      </div>
      <div className={`text-[11px] text-purple-400/60 mt-0.5 leading-relaxed ${expanded ? 'whitespace-pre-wrap' : 'truncate'}`}>
        {expanded ? text : preview + (isLong ? '…' : '')}
      </div>
    </div>
  );
}

function TextBlock({ text }) {
  if (!text.trim()) return null;
  return (
    <div className="my-0.5 px-2.5 py-1.5 text-[12px] text-gray-300 leading-relaxed whitespace-pre-wrap">
      {text}
    </div>
  );
}

// Parse historical log text into structured entries
function parseHistoricalLog(log) {
  if (!log) return [];
  const entries = [];
  const lines = log.split('\n');
  let i = 0;
  while (i < lines.length) {
    let line = lines[i];
    // Parse source prefix [main] or [sub]
    let source = null;
    const sourceMatch = line.match(/^\[(main|sub)\]\s*/);
    if (sourceMatch) {
      source = sourceMatch[1];
      line = line.slice(sourceMatch[0].length);
    }

    const toolMatch = line.match(/^\[tool\]\s*(\w+)(?::?\s*(.*))?$/);
    const thinkingMatch = line.match(/^\[thinking\]\s*(.*)/);
    const resultMatch = line.match(/^\[result\]\s*(.*)/);
    const subagentStartMatch = line.match(/^\[subagent-start\]\s*(.*)/);
    const subagentEndMatch = line.match(/^\[subagent-end\]/);

    if (subagentStartMatch) {
      entries.push({ type: 'subagent-start', text: subagentStartMatch[1] });
    } else if (subagentEndMatch) {
      entries.push({ type: 'subagent-end' });
    } else if (toolMatch) {
      entries.push({ type: 'tool', tool: toolMatch[1], input: toolMatch[2] || '', source });
    } else if (thinkingMatch) {
      let text = thinkingMatch[1];
      while (i + 1 < lines.length && !lines[i + 1].match(/^\[(main|sub)\]?\s*\[(tool|thinking|result|subagent)/)) {
        i++;
        let nextLine = lines[i];
        const nextSource = nextLine.match(/^\[(main|sub)\]\s*/);
        if (nextSource) nextLine = nextLine.slice(nextSource[0].length);
        text += '\n' + nextLine;
      }
      entries.push({ type: 'thinking', text, source });
    } else if (resultMatch) {
      entries.push({ type: 'result', text: resultMatch[1] });
    } else if (line.trim()) {
      entries.push({ type: 'text', text: line });
    }
    i++;
  }
  return entries;
}

// Merge consecutive same-type entries from real-time stream
function mergeEntries(entries) {
  const merged = [];
  for (const e of entries) {
    const last = merged[merged.length - 1];
    if (e.type === 'thinking' && last?.type === 'thinking') {
      last.text += e.text;
    } else if (e.type === 'text' && last?.type === 'text') {
      last.text += e.text;
    } else {
      merged.push({ ...e });
    }
  }
  return merged;
}

export default function LogViewer({ entries, historicalLog }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [entries, historicalLog]);

  const historicalEntries = historicalLog ? parseHistoricalLog(historicalLog) : [];
  const liveEntries = mergeEntries(entries);
  const displayEntries = [...historicalEntries, ...liveEntries];

  if (displayEntries.length === 0) {
    return (
      <div ref={ref} className="flex-1 overflow-y-auto p-4 bg-gray-950 flex items-center justify-center">
        <span className="text-gray-600 text-sm">点击「下一步」或开启「全自动」开始执行工作流</span>
      </div>
    );
  }

  return (
    <div ref={ref} className="flex-1 overflow-y-auto p-3 bg-gray-950 space-y-0.5">
      {displayEntries.map((e, i) => {
        if (e.type === 'tool') return <ToolEntry key={i} tool={e.tool} input={e.input} source={e.source} />;
        if (e.type === 'thinking') return <ThinkingBlock key={i} text={e.text} />;
        if (e.type === 'text') return <TextBlock key={i} text={e.text} />;
        if (e.type === 'result') return (
          <div key={i} className="my-1 px-2.5 py-1.5 rounded-md bg-green-500/5 border border-green-500/20 text-[11px] text-green-400">
            ✓ {e.text}
          </div>
        );
        if (e.type === 'subagent-start') return (
          <div key={i} className="my-2 px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/30 flex items-center gap-2">
            <span className="text-sm">🤖</span>
            <span className="text-[12px] text-purple-300 font-medium">{e.text || 'Subagent'}</span>
            <span className="text-[10px] text-purple-500 ml-auto">启动</span>
          </div>
        );
        if (e.type === 'subagent-end') return (
          <div key={i} className="my-2 px-3 py-1.5 rounded-lg bg-green-500/5 border border-green-500/20 text-[11px] text-green-400">
            ✓ Subagent 完成
          </div>
        );
        return null;
      })}
    </div>
  );
}
