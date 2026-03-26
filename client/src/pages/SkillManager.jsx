import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

const TYPE_COLORS = [
  { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30', dot: 'bg-purple-400' },
  { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30', dot: 'bg-blue-400' },
  { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30', dot: 'bg-orange-400' },
  { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30', dot: 'bg-green-400' },
  { bg: 'bg-pink-500/20', text: 'text-pink-400', border: 'border-pink-500/30', dot: 'bg-pink-400' },
  { bg: 'bg-cyan-500/20', text: 'text-cyan-400', border: 'border-cyan-500/30', dot: 'bg-cyan-400' },
];

export default function SkillManager() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [skills, setSkills] = useState([]);
  const [skillTypes, setSkillTypes] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [filterType, setFilterType] = useState('');
  const [editingType, setEditingType] = useState(null);
  const [newType, setNewType] = useState(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newSkill, setNewSkill] = useState({ name: '', label: '', type: 'instruction', content: '' });
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadSkills().then((list) => {
      const idParam = searchParams.get('id');
      const target = idParam ? list?.find(s => s.id === parseInt(idParam)) : list?.[0];
      if (target) selectSkill(target);
    });
    loadTypes();
  }, []);

  async function loadSkills() {
    const res = await fetch('/api/skills');
    const data = await res.json();
    setSkills(data);
    return data;
  }

  async function loadTypes() {
    const res = await fetch('/api/skills/types');
    setSkillTypes(await res.json());
  }

  const typeLabels = {};
  const typeColorMap = {};
  skillTypes.forEach((t, i) => {
    typeLabels[t.name] = t.label;
    typeColorMap[t.name] = TYPE_COLORS[i % TYPE_COLORS.length];
  });

  async function selectSkill(skill) {
    setSelected(skill.id);
    setCreating(false);
    setConfirmDelete(false);
    const res = await fetch(`/api/skills/${skill.id}`);
    setDetail(await res.json());
  }

  async function saveSkill() {
    if (!detail) return;
    setSaving(true);
    await fetch(`/api/skills/${detail.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: detail.name, label: detail.label, type: detail.type, content: detail.content }),
    });
    setSaving(false);
    loadSkills();
  }

  async function createSkill() {
    if (!newSkill.name || !newSkill.label) return;
    setSaving(true);
    const res = await fetch('/api/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSkill),
    });
    const data = await res.json();
    setSaving(false);
    setCreating(false);
    setNewSkill({ name: '', label: '', type: 'instruction', content: '' });
    await loadSkills();
    selectSkill({ id: data.id });
  }

  async function deleteSkill() {
    if (!detail) return;
    await fetch(`/api/skills/${detail.id}`, { method: 'DELETE' });
    setSelected(null);
    setDetail(null);
    setConfirmDelete(false);
    loadSkills();
  }

  const filtered = skills.filter(s => {
    if (filterType && s.type !== filterType) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return s.label.toLowerCase().includes(q) || s.name.toLowerCase().includes(q);
    }
    return true;
  });

  const typeEditObj = editingType || newType;

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-xl font-bold tracking-tight">Skill 管理</h2>
            <p className="text-sm text-gray-500 mt-0.5">{skills.length} 个 Skill / {skillTypes.length} 种类型</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setNewType({ name: '', label: '', instruction: '' })}
              className="flex items-center gap-1.5 px-3.5 py-2.5 bg-gray-800 text-gray-300 text-sm rounded-xl hover:bg-gray-700 transition-colors border border-gray-700">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
              </svg>
              新类型
            </button>
            <button onClick={() => { setCreating(true); setSelected(null); setDetail(null); }}
              className="flex items-center gap-2 px-4 py-2.5 bg-purple-600 text-white text-sm font-semibold rounded-xl hover:bg-purple-700 transition-colors shadow-lg shadow-purple-600/20">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              新建 Skill
            </button>
          </div>
        </div>

        {/* Type editor overlay */}
        {typeEditObj && (
          <div className="mb-5 bg-gray-900/90 border border-gray-800 rounded-2xl p-5 backdrop-blur-sm">
            <div className="flex items-center gap-2 mb-4">
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
              </svg>
              <h4 className="text-sm font-semibold text-gray-300">{editingType ? '编辑类型' : '创建新类型'}</h4>
            </div>
            <div className="grid grid-cols-[1fr_1fr_2fr] gap-4 mb-4">
              <div>
                <label className="block text-[11px] text-gray-500 font-medium mb-1.5 uppercase tracking-wider">标识名</label>
                <input value={typeEditObj.name}
                  onChange={e => editingType ? setEditingType({ ...editingType, name: e.target.value }) : setNewType({ ...newType, name: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-gray-950 border border-gray-800 rounded-xl text-sm font-mono outline-none focus:border-purple-500/50 transition-colors" placeholder="type-name" />
              </div>
              <div>
                <label className="block text-[11px] text-gray-500 font-medium mb-1.5 uppercase tracking-wider">显示名</label>
                <input value={typeEditObj.label}
                  onChange={e => editingType ? setEditingType({ ...editingType, label: e.target.value }) : setNewType({ ...newType, label: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-gray-950 border border-gray-800 rounded-xl text-sm outline-none focus:border-purple-500/50 transition-colors" placeholder="规范" />
              </div>
              <div>
                <label className="block text-[11px] text-gray-500 font-medium mb-1.5 uppercase tracking-wider">Agent.md 指令文案</label>
                <input value={typeEditObj.instruction}
                  onChange={e => editingType ? setEditingType({ ...editingType, instruction: e.target.value }) : setNewType({ ...newType, instruction: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-gray-950 border border-gray-800 rounded-xl text-sm outline-none focus:border-purple-500/50 transition-colors" placeholder="读取并遵循以下规范：" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <button onClick={async () => {
                  if (editingType) {
                    await fetch(`/api/skills/types/${editingType.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editingType) });
                  } else {
                    await fetch('/api/skills/types', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newType) });
                  }
                  setEditingType(null); setNewType(null); loadTypes();
                }} className="px-4 py-2 text-sm bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors font-semibold">保存</button>
                <button onClick={() => { setEditingType(null); setNewType(null); }}
                  className="px-4 py-2 text-sm bg-gray-800 text-gray-400 rounded-xl hover:bg-gray-700 transition-colors">取消</button>
              </div>
              {editingType && (
                <button onClick={async () => {
                  const res = await fetch(`/api/skills/types/${editingType.id}`, { method: 'DELETE' });
                  const data = await res.json();
                  if (data.error) alert(data.error);
                  else { setEditingType(null); loadTypes(); }
                }} className="px-4 py-2 text-sm text-red-400 border border-red-400/20 rounded-xl hover:bg-red-500/10 transition-colors">
                  删除此类型
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex gap-6" style={{ height: 'calc(100vh - 160px)' }}>
          {/* Left sidebar */}
          <div className="w-80 shrink-0 flex flex-col">
            {/* Search */}
            <div className="relative mb-3">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="搜索 Skill..."
                className="w-full pl-10 pr-3 py-2.5 bg-gray-900 border border-gray-800 rounded-xl text-sm outline-none focus:border-purple-500/50 transition-colors placeholder:text-gray-600" />
            </div>

            {/* Type filter + type badges */}
            <div className="flex gap-1.5 mb-3 flex-wrap">
              <button onClick={() => setFilterType('')}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${!filterType ? 'bg-purple-600/20 text-purple-400 border border-purple-500/30' : 'bg-gray-900 text-gray-500 border border-transparent hover:border-gray-800'}`}>
                全部
              </button>
              {skillTypes.map((t, i) => {
                const c = TYPE_COLORS[i % TYPE_COLORS.length];
                const active = filterType === t.name;
                return (
                  <div key={t.id} className={`group/type inline-flex items-center gap-1 rounded-lg text-[11px] font-medium transition-colors border ${
                      active ? `${c.bg} ${c.text} ${c.border}` : `bg-gray-900 text-gray-500 border-transparent hover:border-gray-800`
                    }`}>
                    <button onClick={() => setFilterType(active ? '' : t.name)}
                      className="px-2.5 py-1.5">
                      {t.label}
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); setEditingType({ ...t }); }}
                      className="pr-2 py-1.5 opacity-0 group-hover/type:opacity-60 hover:!opacity-100 hover:text-purple-400"
                      title="编辑类型">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Skill list */}
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 -mr-1">
              {filtered.map(skill => {
                const c = typeColorMap[skill.type] || TYPE_COLORS[0];
                return (
                  <div key={skill.id} onClick={() => selectSkill(skill)}
                    className={`group px-4 py-3 rounded-xl cursor-pointer transition-all border ${
                      selected === skill.id
                        ? 'bg-purple-600/10 border-purple-500/30 shadow-sm shadow-purple-500/5'
                        : 'border-transparent hover:bg-gray-900 hover:border-gray-800'
                    }`}>
                    <div className="flex items-start justify-between mb-1">
                      <div className="text-sm font-semibold text-gray-200">{skill.label}</div>
                      <span className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold ${c.bg} ${c.text}`}>
                        <span className={`w-1 h-1 rounded-full ${c.dot}`} />
                        {typeLabels[skill.type] || skill.type}
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-500 font-mono">{skill.name}</div>
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-gray-600">
                  <svg className="w-8 h-8 mb-2 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <p className="text-xs">没有匹配的 Skill</p>
                </div>
              )}
            </div>
          </div>

          {/* Right panel */}
          <div className="flex-1 overflow-y-auto flex flex-col">
            {creating ? (
              <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-8 backdrop-blur-sm">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-purple-600/20 flex items-center justify-center">
                    <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">创建新 Skill</h3>
                    <p className="text-xs text-gray-500">添加可复用的指令、规范或门禁</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-5 mb-5">
                  <div>
                    <label className="block text-[11px] text-gray-500 font-medium mb-1.5 uppercase tracking-wider">名称标识</label>
                    <input value={newSkill.name} onChange={e => setNewSkill({ ...newSkill, name: e.target.value })}
                      placeholder="my-skill" className="w-full px-3.5 py-2.5 bg-gray-950 border border-gray-800 rounded-xl text-sm font-mono outline-none focus:border-purple-500/50 transition-colors" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 font-medium mb-1.5 uppercase tracking-wider">显示名称</label>
                    <input value={newSkill.label} onChange={e => setNewSkill({ ...newSkill, label: e.target.value })}
                      placeholder="我的 Skill" className="w-full px-3.5 py-2.5 bg-gray-950 border border-gray-800 rounded-xl text-sm outline-none focus:border-purple-500/50 transition-colors" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-500 font-medium mb-1.5 uppercase tracking-wider">类型</label>
                    <select value={newSkill.type} onChange={e => setNewSkill({ ...newSkill, type: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-gray-950 border border-gray-800 rounded-xl text-sm outline-none focus:border-purple-500/50 transition-colors">
                      {skillTypes.map(t => <option key={t.id} value={t.name}>{t.label}</option>)}
                    </select>
                  </div>
                </div>
                <div className="mb-5">
                  <label className="block text-[11px] text-gray-500 font-medium mb-1.5 uppercase tracking-wider">内容</label>
                  <textarea value={newSkill.content} onChange={e => setNewSkill({ ...newSkill, content: e.target.value })}
                    className="w-full h-72 px-4 py-3 bg-gray-950 border border-gray-800 rounded-xl text-sm font-mono outline-none focus:border-purple-500/50 transition-colors resize-none leading-relaxed"
                    spellCheck={false} placeholder="在此编写 Skill 内容..." />
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setCreating(false)} className="px-5 py-2.5 bg-gray-800 text-gray-400 text-sm rounded-xl hover:bg-gray-700 transition-colors">取消</button>
                  <button onClick={createSkill} disabled={saving}
                    className="px-5 py-2.5 bg-purple-600 text-white text-sm font-semibold rounded-xl hover:bg-purple-700 transition-colors disabled:opacity-50 shadow-lg shadow-purple-600/20">
                    {saving ? '创建中...' : '创建 Skill'}
                  </button>
                </div>
              </div>
            ) : detail ? (
              <div className="flex flex-col flex-1 space-y-5">
                {/* Header card */}
                <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-6 backdrop-blur-sm">
                  <div className="flex items-start justify-between mb-5">
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold ${(typeColorMap[detail.type] || TYPE_COLORS[0]).bg} ${(typeColorMap[detail.type] || TYPE_COLORS[0]).text}`}>
                        {detail.type === 'gate' ? '⛩' : detail.type === 'standard' ? '📏' : detail.type === 'prompt' ? '💬' : '⚡'}
                      </div>
                      <div>
                        <h3 className="text-lg font-bold">{detail.label}</h3>
                        <span className="text-xs text-gray-500 font-mono">{detail.name}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {confirmDelete ? (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded-xl">
                          <span className="text-xs text-red-400">确定删除？关联 Agent 也会移除引用</span>
                          <button onClick={deleteSkill} className="px-2.5 py-1 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">确定</button>
                          <button onClick={() => setConfirmDelete(false)} className="px-2.5 py-1 text-xs bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors">取消</button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmDelete(true)} className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                      <button onClick={saveSkill} disabled={saving}
                        className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50 hover:bg-purple-700 transition-colors shadow-lg shadow-purple-600/20">
                        {saving ? (
                          <>
                            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                            保存中
                          </>
                        ) : '保存'}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-[11px] text-gray-500 font-medium mb-1.5 uppercase tracking-wider">名称</label>
                      <input value={detail.name} onChange={e => setDetail({ ...detail, name: e.target.value })}
                        className="w-full px-3.5 py-2.5 bg-gray-950 border border-gray-800 rounded-xl text-sm font-mono outline-none focus:border-purple-500/50 transition-colors" />
                    </div>
                    <div>
                      <label className="block text-[11px] text-gray-500 font-medium mb-1.5 uppercase tracking-wider">显示名</label>
                      <input value={detail.label} onChange={e => setDetail({ ...detail, label: e.target.value })}
                        className="w-full px-3.5 py-2.5 bg-gray-950 border border-gray-800 rounded-xl text-sm outline-none focus:border-purple-500/50 transition-colors" />
                    </div>
                    <div>
                      <label className="block text-[11px] text-gray-500 font-medium mb-1.5 uppercase tracking-wider">类型</label>
                      <select value={detail.type} onChange={e => setDetail({ ...detail, type: e.target.value })}
                        className="w-full px-3.5 py-2.5 bg-gray-950 border border-gray-800 rounded-xl text-sm outline-none focus:border-purple-500/50 transition-colors">
                        {skillTypes.map(t => <option key={t.id} value={t.name}>{t.label}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Content editor card */}
                <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-6 backdrop-blur-sm flex-1 flex flex-col">
                  <div className="flex items-center gap-2 mb-3">
                    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <label className="text-sm font-semibold text-gray-300">内容</label>
                    <span className="text-[10px] text-gray-600 font-mono ml-auto">{(detail.content || '').length} 字符</span>
                  </div>
                  <textarea value={detail.content} onChange={e => setDetail({ ...detail, content: e.target.value })}
                    className="flex-1 px-4 py-3 bg-gray-950 border border-gray-800 rounded-xl text-sm font-mono outline-none focus:border-purple-500/50 transition-colors resize-none leading-relaxed min-h-[300px]"
                    spellCheck={false} placeholder="在此编写 Skill 内容..." />
                </div>

                {/* Referenced agents */}
                {detail.agents?.length > 0 && (
                  <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-6 backdrop-blur-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                      <label className="text-sm font-semibold text-gray-300">被引用</label>
                      <span className="text-[10px] text-gray-600 ml-1">{detail.agents.length} 个 Agent</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {detail.agents.map(a => (
                        <span key={a.id} onClick={() => navigate(`/agents?id=${a.id}`)}
                          className="inline-flex items-center gap-2 px-3 py-2 bg-gray-950/60 rounded-xl border border-gray-800 hover:border-purple-500/30 cursor-pointer transition-colors group">
                          <div className="w-6 h-6 rounded-lg bg-purple-500/10 flex items-center justify-center text-[10px] font-bold text-purple-400">
                            {a.label?.[0] || 'A'}
                          </div>
                          <div>
                            <span className="text-xs text-gray-300 group-hover:text-purple-400 transition-colors">{a.label}</span>
                            <span className="text-[10px] text-gray-600 ml-1.5">{a.role}</span>
                          </div>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-600">
                <div className="w-16 h-16 rounded-2xl bg-gray-900 border border-gray-800 flex items-center justify-center mb-4">
                  <svg className="w-7 h-7 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-gray-500">选择一个 Skill 查看或编辑</p>
                <p className="text-xs text-gray-600 mt-1">双击类型标签可编辑类型</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
