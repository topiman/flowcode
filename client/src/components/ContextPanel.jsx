import { useState, useEffect } from 'react';

export default function ContextPanel({ workflowId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/workflows/${workflowId}/context`);
      const d = await res.json();
      console.log('[ContextPanel] response:', d);
      if (d && !d.error) setData(d);
    } catch (e) {
      console.error('[ContextPanel] error:', e);
    }
    setLoading(false);
  }

  useEffect(() => { if (workflowId) load(); }, [workflowId]);

  if (!data) return null;
  if (!data.total && !data.model) return (
    <div className="mt-4 p-3 bg-gray-800/50 rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[11px] uppercase tracking-wider text-gray-500">Context</h4>
        <button onClick={load} disabled={loading} className="text-[10px] text-gray-500 hover:text-gray-300">{loading ? '...' : '刷新'}</button>
      </div>
      <div className="text-xs text-gray-600">Session 无数据</div>
    </div>
  );

  const totalCells = 80;
  const cellMap = [];
  for (const cat of (data.categories || [])) {
    const cells = Math.max(0, Math.round(cat.pct / 100 * totalCells));
    const cls = catClass(cat.name);
    for (let i = 0; i < cells; i++) cellMap.push(cls);
  }
  while (cellMap.length < totalCells) cellMap.push('free');

  return (
    <div className="mt-4 p-3 bg-gray-800/50 rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[11px] uppercase tracking-wider text-gray-500">Context</h4>
        <button onClick={load} disabled={loading} className="text-[10px] text-gray-500 hover:text-gray-300">{loading ? '...' : '刷新'}</button>
      </div>

      <div className="text-xs mb-2">
        <span className="text-purple-400 font-semibold">{data.model}</span>
        <span className="text-gray-500"> · {fmt(data.used)} / {fmt(data.total)} ({data.pct}%)</span>
      </div>

      <div className="grid grid-cols-10 gap-px mb-2">
        {cellMap.map((cls, i) => (
          <div key={i} className={`aspect-square rounded-sm border ${CELL_STYLES[cls] || 'border-gray-700'}`} />
        ))}
      </div>

      <div className="flex flex-wrap gap-x-2.5 gap-y-1">
        {(data.categories || []).filter(c => c.pct >= 0.1).map((cat, i) => (
          <div key={i} className="flex items-center gap-1 text-[10px] text-gray-500">
            <div className={`w-2 h-2 rounded-sm ${DOT_STYLES[catClass(cat.name)] || 'bg-gray-700'}`} />
            {cat.name}: {fmt(cat.tokens)} ({cat.pct}%)
          </div>
        ))}
      </div>
    </div>
  );
}

function fmt(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function catClass(name) {
  const n = name.toLowerCase();
  if (n.includes('system prompt')) return 'sysprompt';
  if (n.includes('system tool') || n.includes('deferred')) return 'systool';
  if (n.includes('memory')) return 'memory';
  if (n.includes('skill')) return 'skills';
  if (n.includes('message')) return 'messages';
  if (n.includes('autocompact')) return 'autocompact';
  return 'free';
}

const CELL_STYLES = {
  sysprompt: 'bg-purple-500/60 border-purple-500/80',
  systool: 'bg-purple-500/30 border-purple-500/50',
  memory: 'bg-orange-500/50 border-orange-500/70',
  skills: 'bg-yellow-500/50 border-yellow-500/70',
  messages: 'bg-blue-400/50 border-blue-400/70',
  autocompact: 'bg-gray-700/50 border-gray-600',
  free: 'border-gray-700/50',
};

const DOT_STYLES = {
  sysprompt: 'bg-purple-500/70',
  systool: 'bg-purple-500/40',
  memory: 'bg-orange-500/60',
  skills: 'bg-yellow-500/60',
  messages: 'bg-blue-400/60',
  autocompact: 'bg-gray-600',
  free: 'bg-transparent',
};
