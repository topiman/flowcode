import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function ConversationList() {
  const [conversations, setConversations] = useState([]);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const navigate = useNavigate();

  useEffect(() => { load(); }, []);

  async function load() {
    const convRes = await fetch('/api/conversations');
    setConversations(await convRes.json());
  }

  async function createNew() {
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    navigate(`/conversations/${data.id}`);
  }

  async function doDelete(id) {
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    setConfirmDelete(null);
    load();
  }

  const STATUS = { chatting: '沟通中', confirmed: '已确认', archived: '已归档' };
  const STATUS_COLOR = {
    chatting: 'bg-purple-500/20 text-purple-400',
    confirmed: 'bg-green-500/20 text-green-400',
    archived: 'bg-gray-500/20 text-gray-400',
  };

  return (
    <div className="min-h-screen">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">需求沟通</h2>
          <div className="flex gap-2">
            <button onClick={createNew} className="px-4 py-2 bg-purple-600 text-white text-sm font-semibold rounded-lg hover:bg-purple-700">
              + 全新项目
            </button>
          </div>
        </div>

        {conversations.length === 0 ? (
          <div className="text-center text-gray-500 mt-20">
            <p className="text-lg mb-2">还没有需求沟通</p>
            <p className="text-sm mb-4">开始一次需求沟通，AI 分析师会帮你梳理想法</p>
            <button onClick={createNew} className="px-6 py-2 bg-purple-600 text-white rounded-lg">开始沟通</button>
          </div>
        ) : (
          <div className="space-y-2">
            {conversations.map(c => (
              <div key={c.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between hover:border-gray-700 transition">
                <div className="flex items-center gap-3 cursor-pointer flex-1" onClick={() => navigate(`/conversations/${c.id}`)}>
                  <div>
                    <div className="text-sm font-medium">{c.project_name || c.name}</div>
                    <div className="text-xs text-gray-500">{new Date(c.created_at).toLocaleString()}</div>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${STATUS_COLOR[c.status] || ''}`}>
                    {STATUS[c.status] || c.status}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {c.status === 'confirmed' && c.project_name && (
                    <span className="text-xs text-green-400">→ {c.project_name}</span>
                  )}
                  {confirmDelete === c.id ? (
                    <>
                      <span className="text-xs text-red-400">确定？</span>
                      <button onClick={() => doDelete(c.id)} className="px-2 py-1 text-xs bg-red-600 text-white rounded">确定</button>
                      <button onClick={() => setConfirmDelete(null)} className="px-2 py-1 text-xs bg-gray-700 text-gray-300 rounded">取消</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmDelete(c.id)} className="text-xs text-gray-500 hover:text-red-400">删除</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
