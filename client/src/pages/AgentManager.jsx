import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

const COLORS = [
  { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30', dot: 'bg-purple-400' },
  { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30', dot: 'bg-blue-400' },
  { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30', dot: 'bg-orange-400' },
  { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30', dot: 'bg-green-400' },
  { bg: 'bg-pink-500/20', text: 'text-pink-400', border: 'border-pink-500/30', dot: 'bg-pink-400' },
  { bg: 'bg-cyan-500/20', text: 'text-cyan-400', border: 'border-cyan-500/30', dot: 'bg-cyan-400' },
];

const MODEL_LABELS = {
  'claude-opus-4-6': { label: 'Opus', color: 'text-amber-400 bg-amber-400/10 border-amber-400/20' },
  'claude-sonnet-4-6': { label: 'Sonnet', color: 'text-sky-400 bg-sky-400/10 border-sky-400/20' },
  'claude-haiku-4-5-20251001': { label: 'Haiku', color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' },
};

function IOList({ label, icon, items, onChange }) {
  const [adding, setAdding] = useState(false);
  const [newPath, setNewPath] = useState('');

  function add() {
    if (!newPath.trim()) return;
    onChange([...items, newPath.trim()]);
    setNewPath('');
    setAdding(false);
  }

  return (
    <div>
      <h4 className="text-xs text-gray-400 font-semibold mb-2 flex items-center gap-1.5">
        <span className="opacity-60">{icon}</span> {label}
      </h4>
      <div className="space-y-1.5 mb-2">
        {items.map((path, i) => (
          <div key={i} className="flex items-center gap-2 group">
            <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 bg-gray-950/80 border border-gray-800 rounded-lg">
              <svg className="w-3 h-3 text-gray-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="text-xs font-mono text-gray-400 truncate">{path}</span>
            </div>
            <button onClick={() => onChange(items.filter((_, idx) => idx !== i))}
              className="opacity-0 group-hover:opacity-100 text-red-400/60 hover:text-red-400 transition-opacity">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
      {adding ? (
        <div className="flex gap-1.5">
          <input value={newPath} onChange={e => setNewPath(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()}
            placeholder="{projectDir}/file.md" autoFocus
            className="flex-1 px-2.5 py-1.5 bg-gray-950 border border-gray-700 rounded-lg text-xs font-mono outline-none focus:border-purple-500 transition-colors" />
          <button onClick={add} className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors">添加</button>
          <button onClick={() => { setAdding(false); setNewPath(''); }} className="px-3 py-1.5 text-xs bg-gray-800 text-gray-400 rounded-lg hover:bg-gray-700 transition-colors">取消</button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-purple-400 transition-colors">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          添加路径
        </button>
      )}
    </div>
  );
}

export default function AgentManager() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [agents, setAgents] = useState([]);
  const [allSkills, setAllSkills] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [skillTypes, setSkillTypes] = useState([]);

  useEffect(() => {
    fetch('/api/agents').then(r => r.json()).then(data => {
      setAgents(data);
      const idParam = searchParams.get('id');
      const target = idParam ? data.find(a => a.id === parseInt(idParam)) : data[0];
      if (target) selectAgent(target);
    });
    fetch('/api/skills').then(r => r.json()).then(setAllSkills);
    fetch('/api/skills/types').then(r => r.json()).then(setSkillTypes);
  }, []);

  const typeLabels = {};
  const typeColors = {};
  skillTypes.forEach((t, i) => {
    typeLabels[t.name] = t.label;
    typeColors[t.name] = COLORS[i % COLORS.length];
  });

  async function selectAgent(agent) {
    setSelected(agent.id);
    setIsNew(false);
    setConfirmDelete(false);
    const res = await fetch(`/api/agents/${agent.id}`);
    setDetail(await res.json());
  }

  async function saveAgent() {
    if (!detail) return;
    if (isNew && !detail.name?.trim()) return;
    setSaving(true);
    if (isNew) {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: detail.name, label: detail.label, role: detail.role, model: detail.model, prompt: detail.prompt, inputs: detail.inputs, outputs: detail.outputs }),
      });
      const data = await res.json();
      if (data.error) { setSaving(false); return; }
      setIsNew(false);
      const list = await fetch('/api/agents').then(r => r.json());
      setAgents(list);
      setSelected(data.id);
      const full = await fetch(`/api/agents/${data.id}`).then(r => r.json());
      setDetail(full);
    } else {
      await fetch(`/api/agents/${detail.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: detail.label, role: detail.role, prompt: detail.prompt, model: detail.model, inputs: detail.inputs, outputs: detail.outputs }),
      });
      fetch('/api/agents').then(r => r.json()).then(setAgents);
    }
    setSaving(false);
    setSaveOk(true);
    setTimeout(() => setSaveOk(false), 2000);
  }

  async function addSkill(skillId, role) {
    await fetch(`/api/agents/${detail.id}/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId, role }),
    });
    selectAgent({ id: detail.id });
    fetch('/api/agents').then(r => r.json()).then(setAgents);
  }

  async function removeSkill(skillId) {
    await fetch(`/api/agents/${detail.id}/skills/${skillId}`, { method: 'DELETE' });
    selectAgent({ id: detail.id });
    fetch('/api/agents').then(r => r.json()).then(setAgents);
  }

  function startCreateAgent() {
    setSelected(null);
    setIsNew(true);
    setConfirmDelete(false);
    setDetail({ name: '', label: '', role: '', model: '', prompt: '', inputs: [], outputs: [], skills: [] });
  }

  async function doDeleteAgent() {
    if (!detail) return;
    const res = await fetch(`/api/agents/${detail.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.error) {
      alert(data.error);
      setConfirmDelete(false);
      return;
    }
    setSelected(null);
    setDetail(null);
    setConfirmDelete(false);
    fetch('/api/agents').then(r => r.json()).then(setAgents);
  }

  const availableSkills = detail
    ? allSkills.filter(s => !detail.skills?.some(ds => ds.id === s.id))
    : [];

  const filteredAgents = searchQuery
    ? agents.filter(a => a.label.toLowerCase().includes(searchQuery.toLowerCase()) || a.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : agents;

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold tracking-tight">Agent 管理</h2>
            <p className="text-sm text-gray-500 mt-0.5">{agents.length} 个 Agent</p>
          </div>
          <button onClick={startCreateAgent}
            className="flex items-center gap-2 px-4 py-2.5 bg-purple-600 text-white text-sm font-semibold rounded-xl hover:bg-purple-700 transition-colors shadow-lg shadow-purple-600/20">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            新建 Agent
          </button>
        </div>

        <div className="flex gap-6" style={{ height: 'calc(100vh - 160px)' }}>
          {/* Left sidebar */}
          <div className="w-80 shrink-0 flex flex-col">
            {/* Search */}
            <div className="relative mb-3">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="搜索 Agent..."
                className="w-full pl-10 pr-3 py-2.5 bg-gray-900 border border-gray-800 rounded-xl text-sm outline-none focus:border-purple-500/50 transition-colors placeholder:text-gray-600" />
            </div>

            {/* Agent list */}
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 -mr-1">
              {filteredAgents.map(agent => {
                const modelInfo = MODEL_LABELS[agent.model];
                return (
                  <div key={agent.id} onClick={() => selectAgent(agent)}
                    className={`group px-4 py-3 rounded-xl cursor-pointer transition-all border ${
                      selected === agent.id
                        ? 'bg-purple-600/10 border-purple-500/30 shadow-sm shadow-purple-500/5'
                        : 'border-transparent hover:bg-gray-900 hover:border-gray-800'
                    }`}>
                    <div className="flex items-start justify-between mb-1">
                      <div className="text-sm font-semibold text-gray-200">{agent.label}</div>
                      {modelInfo && (
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${modelInfo.color}`}>
                          {modelInfo.label}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-gray-500 font-mono mb-1.5">{agent.name}</div>
                    {agent.role && <div className="text-[11px] text-gray-500 mb-2 line-clamp-1">{agent.role}</div>}
                    {agent.skills?.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {agent.skills.slice(0, 5).map(s => {
                          const c = typeColors[s.type] || COLORS[0];
                          return (
                            <span key={s.id} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border ${c.bg} ${c.text} ${c.border}`}>
                              {s.label}
                            </span>
                          );
                        })}
                        {agent.skills.length > 5 && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] text-gray-500 bg-gray-800">+{agent.skills.length - 5}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right panel */}
          <div className="flex-1 overflow-y-auto">
            {detail ? (
              <div className="space-y-5">
                {/* Header card */}
                <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-6 backdrop-blur-sm">
                  <div className="flex items-start justify-between mb-5">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/20 flex items-center justify-center text-lg font-bold text-purple-400">
                        {detail.label?.[0] || 'A'}
                      </div>
                      <div>
                        <h3 className="text-lg font-bold">{detail.label}</h3>
                        <span className="text-xs text-gray-500 font-mono">{detail.name}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!isNew && confirmDelete ? (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded-xl">
                          <span className="text-xs text-red-400">确定删除此 Agent？</span>
                          <button onClick={doDeleteAgent} className="px-2.5 py-1 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">确定</button>
                          <button onClick={() => setConfirmDelete(false)} className="px-2.5 py-1 text-xs bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors">取消</button>
                        </div>
                      ) : !isNew ? (
                        <button onClick={() => setConfirmDelete(true)} className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      ) : null}
                      <button onClick={saveAgent} disabled={saving}
                        className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50 hover:bg-purple-700 transition-colors shadow-lg shadow-purple-600/20">
                        {saving ? (
                          <>
                            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                            保存中
                          </>
                        ) : '保存'}
                      </button>
                      {saveOk && <span className="text-xs text-green-400 ml-2 animate-pulse">已保存</span>}
                    </div>
                  </div>

                  <div className={`grid ${isNew ? 'grid-cols-4' : 'grid-cols-3'} gap-4`}>
                    {isNew && (
                      <div>
                        <label className="block text-[11px] text-gray-500 font-medium mb-1.5 uppercase tracking-wider">名称标识</label>
                        <input value={detail.name} onChange={e => setDetail({ ...detail, name: e.target.value })} placeholder="agent-xx-name"
                          className="w-full px-3.5 py-2.5 bg-gray-950 border border-gray-800 rounded-xl text-sm font-mono outline-none focus:border-purple-500/50 transition-colors" />
                      </div>
                    )}
                    <div>
                      <label className="block text-[11px] text-gray-500 font-medium mb-1.5 uppercase tracking-wider">显示名</label>
                      <input value={detail.label} onChange={e => setDetail({ ...detail, label: e.target.value })}
                        className="w-full px-3.5 py-2.5 bg-gray-950 border border-gray-800 rounded-xl text-sm outline-none focus:border-purple-500/50 transition-colors" />
                    </div>
                    <div>
                      <label className="block text-[11px] text-gray-500 font-medium mb-1.5 uppercase tracking-wider">角色</label>
                      <input value={detail.role} onChange={e => setDetail({ ...detail, role: e.target.value })}
                        className="w-full px-3.5 py-2.5 bg-gray-950 border border-gray-800 rounded-xl text-sm outline-none focus:border-purple-500/50 transition-colors" />
                    </div>
                    <div>
                      <label className="block text-[11px] text-gray-500 font-medium mb-1.5 uppercase tracking-wider">模型</label>
                      <select value={detail.model || ''} onChange={e => setDetail({ ...detail, model: e.target.value || null })}
                        className="w-full px-3.5 py-2.5 bg-gray-950 border border-gray-800 rounded-xl text-sm outline-none focus:border-purple-500/50 transition-colors">
                        <option value="">继承主会话</option>
                        <option value="claude-opus-4-6">Opus 4.6</option>
                        <option value="claude-sonnet-4-6">Sonnet 4.6</option>
                        <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Prompt card */}
                <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-6 backdrop-blur-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <label className="text-sm font-semibold text-gray-300">角色指令</label>
                    <span className="text-[10px] text-gray-600 font-mono ml-auto">{(detail.prompt || '').length} 字符</span>
                  </div>
                  <textarea value={detail.prompt || ''} onChange={e => setDetail({ ...detail, prompt: e.target.value })}
                    className="w-full h-56 px-4 py-3 bg-gray-950 border border-gray-800 rounded-xl text-sm font-mono outline-none focus:border-purple-500/50 transition-colors resize-y leading-relaxed"
                    spellCheck={false} placeholder="描述这个 Agent 的专业能力、方法论、质量标准..." />
                </div>

                {/* IO card */}
                <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-6 backdrop-blur-sm">
                  <div className="flex items-center gap-2 mb-4">
                    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                    </svg>
                    <label className="text-sm font-semibold text-gray-300">输入 / 输出文件</label>
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <IOList label="输入文件" icon="↓" items={detail.inputs || []} onChange={items => setDetail({ ...detail, inputs: items })} />
                    <IOList label="输出文件" icon="↑" items={detail.outputs || []} onChange={items => setDetail({ ...detail, outputs: items })} />
                  </div>
                </div>

                {/* Skills card */}
                {!isNew && <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-6 backdrop-blur-sm">
                  <div className="flex items-center gap-2 mb-4">
                    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <label className="text-sm font-semibold text-gray-300">关联 Skills</label>
                    <span className="text-[10px] text-gray-600 ml-1">{detail.skills?.length || 0} 项</span>
                  </div>

                  {detail.skills?.length > 0 ? (
                    <div className="space-y-2 mb-5">
                      {detail.skills.map(skill => {
                        const c = typeColors[skill.type] || COLORS[0];
                        return (
                          <div key={skill.id} className="flex items-center justify-between px-4 py-3 bg-gray-950/60 rounded-xl border border-gray-800 group hover:border-gray-700 transition-colors">
                            <div className="flex items-center gap-3">
                              <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                              <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${c.bg} ${c.text}`}>
                                {typeLabels[skill.type] || skill.type}
                              </span>
                              <span className="text-sm text-gray-300 hover:text-purple-400 cursor-pointer transition-colors"
                                onClick={() => navigate(`/skills?id=${skill.id}`)}>{skill.label}</span>
                              <span className="text-[11px] text-gray-600 font-mono">{skill.name}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-[10px] text-gray-500 bg-gray-900 px-2 py-0.5 rounded">{skill.skill_role}</span>
                              <button onClick={() => removeSkill(skill.id)}
                                className="opacity-0 group-hover:opacity-100 text-red-400/60 hover:text-red-400 transition-all text-xs">
                                移除
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-6 mb-4 bg-gray-950/40 rounded-xl border border-dashed border-gray-800">
                      <p className="text-sm text-gray-600">尚未关联任何 Skill</p>
                    </div>
                  )}

                  {availableSkills.length > 0 && (
                    <div>
                      <div className="text-[11px] text-gray-500 uppercase tracking-wider font-medium mb-2">可添加的 Skills</div>
                      <div className="flex flex-wrap gap-2">
                        {availableSkills.map(s => {
                          const c = typeColors[s.type] || COLORS[0];
                          return (
                            <button key={s.id} onClick={() => addSkill(s.id, s.type)}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-dashed transition-all hover:scale-[1.02] ${c.border} ${c.text} hover:${c.bg} bg-transparent`}>
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                              </svg>
                              {s.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-600">
                <div className="w-16 h-16 rounded-2xl bg-gray-900 border border-gray-800 flex items-center justify-center mb-4">
                  <svg className="w-7 h-7 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-gray-500">选择一个 Agent 查看详情</p>
                <p className="text-xs text-gray-600 mt-1">或点击右上角创建新 Agent</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
