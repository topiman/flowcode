import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

export default function CreateProject() {
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState(false);
  const navigate = useNavigate();

  function onPathChange(val) {
    setPath(val);
    const segments = val.replace(/\/+$/, '').split('/');
    const last = segments[segments.length - 1] || '';
    setName(last);
  }

  async function pickFolder() {
    setPicking(true);
    try {
      const res = await fetch('/api/projects/pick-folder');
      const data = await res.json();
      if (data.path) onPathChange(data.path);
    } finally {
      setPicking(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!path.trim()) { setError('请输入项目路径'); return; }
    if (!path.startsWith('/')) { setError('请输入绝对路径（以 / 开头）'); return; }

    setLoading(true);
    const res = await fetch('/api/projects/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path.trim(), name: name.trim() || undefined }),
    });
    const data = await res.json();
    setLoading(false);

    if (data.error) { setError(data.error); return; }
    navigate('/');
  }

  return (
    <div className="min-h-screen">
      <form onSubmit={handleSubmit} className="max-w-lg mx-auto mt-12 px-6">
        <h2 className="text-xl font-semibold mb-3">导入新项目</h2>

        <div className="mb-6 p-4 bg-gray-900/50 border border-gray-800 rounded-lg text-sm text-gray-400 space-y-2">
          <p>将已有的项目导入到工作流系统中，导入后即可使用自定义工作流对项目进行迭代开发。</p>
          <ul className="list-disc list-inside space-y-1 text-gray-500">
            <li>支持任意已有项目，无需由本工具创建</li>
            <li>如果项目尚未初始化 Git，系统会自动完成</li>
            <li>导入不会修改项目的现有代码和结构</li>
            <li>导入后可选择工作流模板发起迭代（新功能、Bug 修复、重构等）</li>
          </ul>
        </div>

        <label className="block text-sm text-gray-400 mb-1">项目路径</label>
        <div className="flex gap-2 mb-4">
          <input value={path} onChange={e => onPathChange(e.target.value)} placeholder="/path/to/your-project"
            className="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm focus:border-purple-500 outline-none cursor-pointer"
            onClick={pickFolder} readOnly />
          <button type="button" onClick={pickFolder} disabled={picking}
            className="px-3 py-2 bg-gray-800 border border-gray-700 text-gray-400 text-sm rounded-lg hover:border-purple-500 hover:text-purple-400 disabled:opacity-50 shrink-0">
            {picking ? '选择中...' : '浏览'}
          </button>
        </div>

        <label className="block text-sm text-gray-400 mb-1">项目名称（可选，默认取目录名）</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="my-project"
          className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm focus:border-purple-500 outline-none mb-4" />

        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

        <div className="flex gap-3">
          <Link to="/" className="px-4 py-2 bg-gray-800 text-gray-300 text-sm rounded-lg border border-gray-700">取消</Link>
          <button type="submit" disabled={loading}
            className="px-4 py-2 bg-purple-600 text-white text-sm font-semibold rounded-lg hover:bg-purple-700 disabled:opacity-50">
            {loading ? '导入中...' : '导入'}
          </button>
        </div>
      </form>
    </div>
  );
}
