import { Link } from 'react-router-dom';

export default function TemplateManager() {
  return (
    <div className="min-h-screen">
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <h2 className="text-xl font-semibold mb-4">模板管理已迁移</h2>
        <p className="text-gray-400 mb-6">文档模板和规范文件现在统一在 Skill 管理中，按类型分类。</p>
        <Link to="/skills" className="px-6 py-2 bg-purple-600 text-white text-sm font-semibold rounded-lg hover:bg-purple-700">
          前往 Skill 管理
        </Link>
      </div>
    </div>
  );
}
