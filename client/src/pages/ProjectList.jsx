import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

const STATUS = { 'in-progress': '进行中', completed: '已完成', paused: '已暂停' };

export default function ProjectList() {
  const [projects, setProjects] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [iterOpen, setIterOpen] = useState(null);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [iterDesc, setIterDesc] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmDeleteWf, setConfirmDeleteWf] = useState(null);
  const [confirmDeleteConv, setConfirmDeleteConv] = useState(null);
  const navigate = useNavigate();

  useEffect(() => { load(); }, []);

  function load() {
    fetch('/api/projects').then(r => r.json()).then(setProjects);
    fetch('/api/conversations').then(r => r.json()).then(data => {
      setConversations(data.filter(c => c.status === 'chatting'));
    });
    fetch('/api/templates?scope=iteration').then(r => r.json()).then(setTemplates);
  }

  async function createNewProject() {
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    navigate(`/conversations/${data.id}`);
  }

  async function startIteration(project) {
    if (!selectedTemplate || !iterDesc) return;
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: project.name, description: iterDesc, templateName: selectedTemplate, projectId: project.id }),
    });
    const data = await res.json();
    if (data.workflowId) navigate(`/workflow/${data.workflowId}`);
  }

  async function deleteWorkflow(e, wfId, projectId) {
    e.stopPropagation();
    await fetch(`/api/workflows/${wfId}`, { method: 'DELETE' });
    setConfirmDeleteWf(null);
    setProjects(prev => prev.map(p => p.id === projectId ? { ...p, workflows: p.workflows.filter(w => w.id !== wfId) } : p));
  }

  async function deleteProject(id) {
    await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    setConfirmDelete(null);
    setProjects(prev => prev.filter(p => p.id !== id));
  }

  async function deleteConversation(id) {
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    setConfirmDeleteConv(null);
    setConversations(prev => prev.filter(c => c.id !== id));
  }

  function openIterForm(e, projectId) {
    e.stopPropagation();
    setIterOpen(iterOpen === projectId ? null : projectId);
    setSelectedTemplate('');
    setIterDesc('');
  }

  const isEmpty = projects.length === 0 && conversations.length === 0;

  return (
    <div className="min-h-screen">
      <div className="flex items-center justify-between px-6 pt-6 pb-2">
        <h2 className="text-xl font-semibold">项目列表</h2>
        <div className="flex gap-2">
          <button onClick={createNewProject} className="px-4 py-2 bg-purple-600 text-white text-sm font-semibold rounded-lg hover:bg-purple-700">新建项目</button>
          <Link to="/import" className="px-4 py-2 bg-gray-800 text-gray-300 text-sm font-semibold rounded-lg border border-gray-700 hover:border-purple-500 hover:text-purple-400">导入项目</Link>
        </div>
      </div>

      {isEmpty ? (
        <div className="text-center text-gray-500 mt-32">
          <p>还没有项目</p>
          <div className="flex gap-3 justify-center mt-4">
            <button onClick={createNewProject} className="px-6 py-2 bg-purple-600 text-white rounded-lg">新建项目</button>
            <Link to="/import" className="px-6 py-2 bg-gray-800 text-gray-300 rounded-lg border border-gray-700">导入项目</Link>
          </div>
        </div>
      ) : (
        <div className="p-6">
          {/* Active conversations (drafts) */}
          {conversations.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm text-gray-500 font-medium mb-2">需求沟通中</h3>
              <div className="space-y-2">
                {conversations.map(c => (
                  <div key={c.id} className="flex items-center justify-between px-4 py-3 bg-gray-900 border border-gray-800 rounded-xl hover:border-gray-700 transition cursor-pointer"
                    onClick={() => navigate(`/conversations/${c.id}`)}>
                    <div className="flex items-center gap-3">
                      <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                      <span className="text-sm text-gray-300">{c.project_name || c.name}</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full font-bold bg-purple-500/20 text-purple-400">沟通中</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-600">{new Date(c.created_at).toLocaleString()}</span>
                      {confirmDeleteConv === c.id ? (
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          <button onClick={() => deleteConversation(c.id)} className="px-1.5 py-0.5 text-[10px] bg-red-600 text-white rounded">确定</button>
                          <button onClick={() => setConfirmDeleteConv(null)} className="px-1.5 py-0.5 text-[10px] bg-gray-700 text-gray-300 rounded">取消</button>
                        </div>
                      ) : (
                        <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteConv(c.id); }} className="text-gray-700 hover:text-red-400 text-xs">x</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Projects grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map(p => {
              const canIterate = p.imported || p.workflows?.some(w => w.status === 'completed');
              return (
                <div key={p.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5 relative">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-base font-semibold">{p.name}</h3>
                    {canIterate && (
                      <button onClick={(e) => openIterForm(e, p.id)}
                        className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:border-purple-500 hover:text-purple-400 text-lg leading-none">
                        +
                      </button>
                    )}
                  </div>

                  {/* Workflow list */}
                  <div className="space-y-1.5">
                    {(p.workflows || []).map(w => (
                      <div key={w.id} onClick={() => navigate(`/workflow/${w.id}`)}
                        className="flex items-center justify-between px-3 py-2 bg-gray-950 rounded-lg cursor-pointer hover:bg-gray-800 transition">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${w.status === 'completed' ? 'bg-green-500' : 'bg-purple-500 animate-pulse'}`} />
                          <span className="text-sm text-gray-300">{w.feature_id || '初始开发'}</span>
                          {w.branch && <span className="text-[10px] text-gray-600">{w.branch}</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${w.status === 'completed' ? 'bg-green-500/20 text-green-400' : 'bg-purple-500/20 text-purple-400'}`}>
                            {STATUS[w.status] || w.status}
                          </span>
                          {confirmDeleteWf === w.id ? (
                            <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                              <button onClick={(e) => deleteWorkflow(e, w.id, p.id)} className="px-1.5 py-0.5 text-[10px] bg-red-600 text-white rounded">确定</button>
                              <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteWf(null); }} className="px-1.5 py-0.5 text-[10px] bg-gray-700 text-gray-300 rounded">取消</button>
                            </div>
                          ) : (
                            <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteWf(w.id); }} className="text-gray-700 hover:text-red-400 text-xs">x</button>
                          )}
                        </div>
                      </div>
                    ))}
                    {(!p.workflows || p.workflows.length === 0) && (
                      <div className="text-xs text-gray-600">暂无工作流</div>
                    )}
                  </div>

                  {/* Delete */}
                  <div className="mt-2 pt-2 border-t border-gray-800/50 flex justify-end">
                    {confirmDelete === p.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-red-400">确定删除项目及所有数据？</span>
                        <button onClick={() => deleteProject(p.id)} className="px-2 py-1 text-xs bg-red-600 text-white rounded">确定</button>
                        <button onClick={() => setConfirmDelete(null)} className="px-2 py-1 text-xs bg-gray-700 text-gray-300 rounded">取消</button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDelete(p.id)} className="text-xs text-gray-600 hover:text-red-400">删除</button>
                    )}
                  </div>

                  {/* Iteration form */}
                  {iterOpen === p.id && (
                    <div className="mt-3 pt-3 border-t border-gray-800">
                      <div className="mb-2">
                        <label className="block text-xs text-gray-400 mb-1">工作流模板</label>
                        <select value={selectedTemplate} onChange={e => setSelectedTemplate(e.target.value)}
                          className="w-full px-3 py-1.5 bg-gray-950 border border-gray-700 rounded-lg text-sm outline-none text-gray-200">
                          <option value="">请选择...</option>
                          {templates.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                        </select>
                      </div>
                      <div className="mb-2">
                        <label className="block text-xs text-gray-400 mb-1">简短描述</label>
                        <input value={iterDesc} onChange={e => setIterDesc(e.target.value)} placeholder="如：添加修改密码功能"
                          className="w-full px-3 py-1.5 bg-gray-950 border border-gray-700 rounded-lg text-sm outline-none text-gray-200" />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => startIteration(p)} disabled={!selectedTemplate || !iterDesc}
                          className="px-3 py-1.5 bg-purple-600 text-white text-xs rounded-lg disabled:opacity-50">确认</button>
                        <button onClick={() => setIterOpen(null)}
                          className="px-3 py-1.5 bg-gray-800 text-gray-400 text-xs rounded-lg">取消</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
