import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function WorkflowManager() {
  const [templates, setTemplates] = useState([]);
  const [agents, setAgents] = useState([]);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newTpl, setNewTpl] = useState({ name: '', description: '', frontend: '', backend: '', database: '' });
  const [confirmDelete, setConfirmDelete] = useState(null);
  const navigate = useNavigate();

  useEffect(() => { loadData(); }, []);

  function loadData() {
    fetch('/api/templates').then(r => r.json()).then(setTemplates);
    fetch('/api/agents').then(r => r.json()).then(setAgents);
  }

  const agentMap = {};
  agents.forEach(a => { agentMap[a.name] = a; });

  // ─── Editing helpers ───
  function startEdit(tpl) {
    const ts = tpl.tech_stack && typeof tpl.tech_stack === 'object' ? tpl.tech_stack : {};
    const bc = tpl.branch_config && typeof tpl.branch_config === 'object' ? tpl.branch_config : {};
    setEditing({ ...tpl, steps: JSON.parse(JSON.stringify(tpl.step_sequence)), techStack: ts, branchConfig: bc });
  }

  async function saveEdit() {
    await fetch(`/api/templates/${editing.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editing.name,
        description: editing.description || '',
        tech_stack: editing.techStack || {},
        step_sequence: editing.steps,
        branch_config: editing.branchConfig || {},
        scope: editing.scope || 'all',
      }),
    });
    loadData();
    setEditing(null);
  }

  function removeStep(idx) {
    setEditing(prev => ({ ...prev, steps: prev.steps.filter((_, i) => i !== idx) }));
  }

  function addStep(agentName) {
    setEditing(prev => ({ ...prev, steps: [...prev.steps, agentName] }));
  }

  function moveStep(idx, dir) {
    setEditing(prev => {
      const steps = [...prev.steps];
      const target = idx + dir;
      if (target < 0 || target >= steps.length) return prev;
      [steps[idx], steps[target]] = [steps[target], steps[idx]];
      return { ...prev, steps };
    });
  }

  // Group selected steps into parallel
  function groupParallel(idx) {
    setEditing(prev => {
      const steps = [...prev.steps];
      const current = steps[idx];
      const next = steps[idx + 1];
      if (!next) return prev;
      // Merge into parallel group
      if (Array.isArray(current) && !Array.isArray(next)) {
        steps[idx] = [...current, next];
        steps.splice(idx + 1, 1);
      } else if (!Array.isArray(current) && Array.isArray(next)) {
        steps[idx] = [current, ...next];
        steps.splice(idx + 1, 1);
      } else if (Array.isArray(current) && Array.isArray(next)) {
        steps[idx] = [...current, ...next];
        steps.splice(idx + 1, 1);
      } else {
        steps[idx] = [current, next];
        steps.splice(idx + 1, 1);
      }
      return { ...prev, steps };
    });
  }

  // Ungroup parallel back to sequential
  function ungroupParallel(idx) {
    setEditing(prev => {
      const steps = [...prev.steps];
      const group = steps[idx];
      if (!Array.isArray(group)) return prev;
      steps.splice(idx, 1, ...group);
      return { ...prev, steps };
    });
  }

  // Remove one agent from a parallel group
  function removeFromGroup(groupIdx, agentIdx) {
    setEditing(prev => {
      const steps = [...prev.steps];
      const group = [...steps[groupIdx]];
      group.splice(agentIdx, 1);
      if (group.length === 1) steps[groupIdx] = group[0]; // Ungroup if only 1 left
      else if (group.length === 0) steps.splice(groupIdx, 1);
      else steps[groupIdx] = group;
      return { ...prev, steps };
    });
  }

  async function createTemplate() {
    if (!newTpl.name) return;
    await fetch('/api/templates', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newTpl.name,
        description: newTpl.description,
        tech_stack: { frontend: newTpl.frontend, backend: newTpl.backend, database: newTpl.database },
        step_sequence: [],
      }),
    });
    setCreating(false);
    setNewTpl({ name: '', description: '', frontend: '', backend: '', database: '' });
    loadData();
  }

  async function doDeleteTemplate() {
    if (!confirmDelete) return;
    await fetch(`/api/templates/${confirmDelete}`, { method: 'DELETE' });
    if (editing?.id === confirmDelete) setEditing(null);
    setConfirmDelete(null);
    loadData();
  }

  // Get all agent names already used in current editing steps (flat)
  function usedAgents(steps) {
    return steps.flatMap(s => Array.isArray(s) ? s : [s]);
  }

  // ─── Render ───
  function renderStepNode(step, idx, isEditing) {
    if (Array.isArray(step)) {
      return renderParallelGroup(step, idx, isEditing);
    }
    return renderSingleStep(step, idx, isEditing);
  }

  function renderSingleStep(name, idx, isEditing) {
    const agent = agentMap[name];
    const label = agent?.label || name;
    const model = agent?.model;
    const modelShort = model?.includes('opus') ? 'Opus' : model?.includes('sonnet') ? 'Sonnet' : model?.includes('haiku') ? 'Haiku' : null;

    return (
      <div key={name + idx} className="flex items-center gap-2">
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${isEditing ? 'bg-gray-800 border-gray-600' : 'bg-gray-800/40 border-gray-700/40'}`}>
          <div className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-400 text-[10px] flex items-center justify-center font-bold shrink-0">{idx + 1}</div>
          <span className="text-sm text-gray-200 hover:text-purple-400 cursor-pointer" onClick={e => { e.stopPropagation(); if (agent) navigate(`/agents?id=${agent.id}`); }}>{label}</span>
          {modelShort && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">{modelShort}</span>}
          {isEditing && (
            <div className="flex items-center gap-0.5 ml-1">
              <button onClick={() => moveStep(idx, -1)} className="text-gray-500 hover:text-gray-300 text-[10px] px-1">↑</button>
              <button onClick={() => moveStep(idx, 1)} className="text-gray-500 hover:text-gray-300 text-[10px] px-1">↓</button>
              <button onClick={() => groupParallel(idx)} title="与下一步合并为并行" className="text-blue-400/50 hover:text-blue-400 text-[10px] px-1">∥</button>
              <button onClick={() => removeStep(idx)} className="text-red-400/50 hover:text-red-400 text-[10px] px-1">✕</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderParallelGroup(group, idx, isEditing) {
    return (
      <div key={'parallel-' + idx} className="flex items-center gap-2">
        <div className="border border-blue-500/30 bg-blue-500/5 rounded-xl px-3 py-2">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] text-blue-400 font-semibold uppercase">并行</span>
            {isEditing && (
              <button onClick={() => ungroupParallel(idx)} className="text-[10px] text-gray-500 hover:text-gray-300">拆分</button>
            )}
          </div>
          <div className="flex flex-col gap-1">
            {group.map((name, gi) => {
              const agent = agentMap[name];
              const label = agent?.label || name;
              const modelShort = agent?.model?.includes('opus') ? 'Opus' : agent?.model?.includes('sonnet') ? 'Sonnet' : null;
              return (
                <div key={name} className="flex items-center gap-2 px-2 py-1 bg-gray-800/60 rounded-lg">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                  <span className="text-sm text-gray-200 hover:text-purple-400 cursor-pointer" onClick={e => { e.stopPropagation(); if (agent) navigate(`/agents?id=${agent.id}`); }}>{label}</span>
                  {modelShort && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">{modelShort}</span>}
                  {isEditing && (
                    <button onClick={() => removeFromGroup(idx, gi)} className="text-red-400/50 hover:text-red-400 text-[10px] ml-1">✕</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold">工作流管理</h2>
            <p className="text-sm text-gray-500 mt-1">定义工作流模板的 Agent 执行顺序。支持串行和并行编排。</p>
          </div>
          <button onClick={() => setCreating(true)} className="px-4 py-2 bg-purple-600 text-white text-sm font-semibold rounded-lg hover:bg-purple-700">+ 新工作流</button>
        </div>

        {/* Create form */}
        {creating && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-4">
            <h3 className="text-base font-semibold mb-3">创建新工作流模板</h3>
            <div className="flex gap-3 mb-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">名称</label>
                <input value={newTpl.name} onChange={e => setNewTpl({ ...newTpl, name: e.target.value })} placeholder="全新项目-React全栈"
                  className="px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm outline-none focus:border-purple-500" />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-400 mb-1">描述</label>
                <input value={newTpl.description} onChange={e => setNewTpl({ ...newTpl, description: e.target.value })} placeholder="适合中型全栈 Web 应用"
                  className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm outline-none focus:border-purple-500" />
              </div>
            </div>
            <div className="flex gap-3 mb-3">
              <div className="flex-1">
                <label className="block text-xs text-gray-400 mb-1">前端</label>
                <input value={newTpl.frontend} onChange={e => setNewTpl({ ...newTpl, frontend: e.target.value })} placeholder="React + Vite"
                  className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm outline-none focus:border-purple-500" />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-400 mb-1">后端</label>
                <input value={newTpl.backend} onChange={e => setNewTpl({ ...newTpl, backend: e.target.value })} placeholder="Express"
                  className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm outline-none focus:border-purple-500" />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-400 mb-1">数据库</label>
                <input value={newTpl.database} onChange={e => setNewTpl({ ...newTpl, database: e.target.value })} placeholder="SQLite"
                  className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm outline-none focus:border-purple-500" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setCreating(false)} className="px-3 py-1.5 text-xs bg-gray-800 text-gray-400 rounded-lg">取消</button>
              <button onClick={createTemplate} className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded-lg">创建</button>
            </div>
          </div>
        )}

        {/* Workflow templates */}
        <div className="space-y-4">
          {templates.map(tpl => {
            const isEditing = editing?.id === tpl.id;
            const steps = isEditing ? editing.steps : tpl.step_sequence;
            const flatCount = steps.flatMap(s => Array.isArray(s) ? s : [s]).length;

            return (
              <div key={tpl.id} className="border rounded-xl p-5 border-gray-700 bg-gray-900/50">
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    {isEditing ? (
                      <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                        className="text-lg font-semibold bg-transparent border-b border-gray-600 outline-none focus:border-purple-500 w-40" />
                    ) : (
                      <h3 className="text-lg font-semibold">{tpl.name}</h3>
                    )}
                    <span className="text-xs text-gray-500">{flatCount} 个 agent · {steps.length} 步</span>
                  </div>
                  {isEditing ? (
                    <div className="flex gap-2">
                      <button onClick={() => setEditing(null)} className="px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 rounded-lg text-gray-400">取消</button>
                      <button onClick={saveEdit} className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded-lg">保存</button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      {confirmDelete === tpl.id ? (
                        <>
                          <span className="text-xs text-red-400 self-center">确定删除？</span>
                          <button onClick={doDeleteTemplate} className="px-2 py-1 text-xs bg-red-600 text-white rounded-lg">确定</button>
                          <button onClick={() => setConfirmDelete(null)} className="px-2 py-1 text-xs bg-gray-700 text-gray-300 rounded-lg">取消</button>
                        </>
                      ) : (
                        <button onClick={() => setConfirmDelete(tpl.id)} className="px-3 py-1.5 text-xs text-red-400 border border-red-400/30 rounded-lg hover:bg-red-500/10">删除</button>
                      )}
                      <button onClick={() => startEdit(tpl)} className="px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 rounded-lg text-gray-400 hover:border-purple-500">编辑</button>
                    </div>
                  )}
                </div>

                {/* Description + Tech Stack */}
                {isEditing ? (
                  <div className="mb-4 space-y-2">
                    <input
                      value={editing.description || ''}
                      onChange={e => setEditing({ ...editing, description: e.target.value })}
                      placeholder="描述（Claude 用于推荐模板）"
                      className="w-full px-3 py-1.5 bg-gray-950 border border-gray-700 rounded-lg text-sm outline-none focus:border-purple-500 text-gray-300 placeholder-gray-600"
                    />
                    <div className="flex gap-2">
                      <input
                        value={editing.techStack?.frontend || ''}
                        onChange={e => setEditing({ ...editing, techStack: { ...editing.techStack, frontend: e.target.value } })}
                        placeholder="前端（如 React + Vite）"
                        className="flex-1 px-3 py-1.5 bg-gray-950 border border-gray-700 rounded-lg text-sm outline-none focus:border-purple-500 text-gray-300 placeholder-gray-600"
                      />
                      <input
                        value={editing.techStack?.backend || ''}
                        onChange={e => setEditing({ ...editing, techStack: { ...editing.techStack, backend: e.target.value } })}
                        placeholder="后端（如 Express）"
                        className="flex-1 px-3 py-1.5 bg-gray-950 border border-gray-700 rounded-lg text-sm outline-none focus:border-purple-500 text-gray-300 placeholder-gray-600"
                      />
                      <input
                        value={editing.techStack?.database || ''}
                        onChange={e => setEditing({ ...editing, techStack: { ...editing.techStack, database: e.target.value } })}
                        placeholder="数据库（如 SQLite）"
                        className="flex-1 px-3 py-1.5 bg-gray-950 border border-gray-700 rounded-lg text-sm outline-none focus:border-purple-500 text-gray-300 placeholder-gray-600"
                      />
                    </div>
                    <div className="flex gap-2">
                      <input
                        value={editing.branchConfig?.base || ''}
                        onChange={e => setEditing({ ...editing, branchConfig: { ...editing.branchConfig, base: e.target.value } })}
                        placeholder="基础分支（如 main）"
                        className="flex-1 px-3 py-1.5 bg-gray-950 border border-gray-700 rounded-lg text-sm outline-none focus:border-purple-500 text-gray-300 placeholder-gray-600"
                      />
                      <input
                        value={editing.branchConfig?.prefix || ''}
                        onChange={e => setEditing({ ...editing, branchConfig: { ...editing.branchConfig, prefix: e.target.value } })}
                        placeholder="分支前缀（如 feature）"
                        className="flex-1 px-3 py-1.5 bg-gray-950 border border-gray-700 rounded-lg text-sm outline-none focus:border-purple-500 text-gray-300 placeholder-gray-600"
                      />
                      <input
                        value={editing.branchConfig?.idPrefix || ''}
                        onChange={e => setEditing({ ...editing, branchConfig: { ...editing.branchConfig, idPrefix: e.target.value } })}
                        placeholder="ID前缀（如 F）"
                        className="w-20 px-3 py-1.5 bg-gray-950 border border-gray-700 rounded-lg text-sm outline-none focus:border-purple-500 text-gray-300 placeholder-gray-600"
                      />
                      <input
                        value={editing.branchConfig?.pattern || ''}
                        onChange={e => setEditing({ ...editing, branchConfig: { ...editing.branchConfig, pattern: e.target.value } })}
                        placeholder="分支命名（如 {prefix}/{id}-{slug}）"
                        className="flex-1 px-3 py-1.5 bg-gray-950 border border-gray-700 rounded-lg text-sm outline-none focus:border-purple-500 text-gray-300 placeholder-gray-600"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-500">适用场景</label>
                      <select value={editing.scope || 'all'} onChange={e => setEditing({ ...editing, scope: e.target.value })}
                        className="px-3 py-1.5 bg-gray-950 border border-gray-700 rounded-lg text-sm outline-none focus:border-purple-500 text-gray-300">
                        <option value="new">新建项目</option>
                        <option value="iteration">迭代</option>
                        <option value="all">全部</option>
                      </select>
                    </div>
                  </div>
                ) : (
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-gray-400">{tpl.description || <span className="text-gray-600">暂无描述</span>}</span>
                    {(() => {
                      const ts = tpl.tech_stack && typeof tpl.tech_stack === 'object' ? tpl.tech_stack : {};
                      const parts = [ts.frontend, ts.backend, ts.database].filter(Boolean);
                      return parts.length > 0
                        ? <span className="text-xs px-2 py-0.5 bg-blue-500/10 text-blue-400 rounded border border-blue-500/20">{parts.join(' + ')}</span>
                        : <span className="text-xs text-gray-600">暂无技术栈</span>;
                    })()}
                    {(() => {
                      const bc = tpl.branch_config && typeof tpl.branch_config === 'object' ? tpl.branch_config : {};
                      if (!bc.base) return null;
                      const label = bc.prefix ? `${bc.base} → ${bc.prefix}/...` : bc.base;
                      return <span className="text-xs px-2 py-0.5 bg-green-500/10 text-green-400 rounded border border-green-500/20">{label}</span>;
                    })()}
                    <span className={`text-xs px-2 py-0.5 rounded border ${
                      tpl.scope === 'new' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                      tpl.scope === 'iteration' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' :
                      'bg-gray-500/10 text-gray-400 border-gray-500/20'
                    }`}>{tpl.scope === 'new' ? '新建' : tpl.scope === 'iteration' ? '迭代' : '全部'}</span>
                  </div>
                )}

                {/* Pipeline visual */}
                <div className="flex flex-wrap items-center gap-2">
                  {steps.map((step, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      {idx > 0 && <span className="text-gray-600">→</span>}
                      {renderStepNode(step, idx, isEditing)}
                    </div>
                  ))}
                </div>

                {/* Add step (editing) */}
                {isEditing && (
                  <div className="mt-4 pt-3 border-t border-gray-700/30">
                    <div className="text-xs text-gray-500 mb-2">添加步骤:</div>
                    <div className="flex flex-wrap gap-1.5">
                      {agents.filter(a => !usedAgents(editing.steps).includes(a.name)).map(a => (
                        <button key={a.id} onClick={() => addStep(a.name)}
                          className="px-2.5 py-1 text-xs bg-gray-900 border border-dashed border-gray-600 rounded-lg text-gray-400 hover:border-green-500 hover:text-green-400">
                          + {a.label}
                        </button>
                      ))}
                    </div>
                    <div className="text-[10px] text-gray-600 mt-2">
                      提示: ↑↓ 移动顺序 · ∥ 与下一步合并为并行 · 拆分 将并行组恢复为串行
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
