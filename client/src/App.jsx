import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import ProjectList from './pages/ProjectList';
import CreateProject from './pages/CreateProject';
import Dashboard from './pages/Dashboard';
import AgentManager from './pages/AgentManager';
import WorkflowManager from './pages/WorkflowManager';
import SkillManager from './pages/SkillManager';
import ConversationList from './pages/ConversationList';
import ConversationChat from './pages/ConversationChat';

function NavBar() {
  const linkClass = ({ isActive }) =>
    `px-3 py-1.5 rounded-lg text-sm transition ${
      isActive
        ? 'bg-purple-600/20 text-purple-400 font-semibold'
        : 'text-gray-400 hover:text-gray-200'
    }`;

  return (
    <nav className="flex items-center justify-between px-6 py-3 border-b border-gray-800 shrink-0 bg-gray-950">
      <NavLink to="/" className="text-lg font-semibold text-gray-200 hover:text-white">
        Workflow Dashboard
      </NavLink>
      <div className="flex items-center gap-1">
        <NavLink to="/" end className={linkClass}>项目</NavLink>
        <NavLink to="/workflows" className={linkClass}>工作流</NavLink>
        <NavLink to="/agents" className={linkClass}>Agent</NavLink>
        <NavLink to="/skills" className={linkClass}>Skill</NavLink>
      </div>
    </nav>
  );
}

function WithNav({ children }) {
  return (
    <div className="min-h-screen flex flex-col">
      <NavBar />
      <div className="flex-1">{children}</div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Full-screen layouts (no nav) */}
        <Route path="/workflow/:id" element={<Dashboard />} />
        <Route path="/conversations/:id" element={<ConversationChat />} />

        {/* Pages with shared navigation */}
        <Route path="/" element={<WithNav><ProjectList /></WithNav>} />
        {/* ConversationList removed from nav — accessed via ProjectList */}
        <Route path="/import" element={<WithNav><CreateProject /></WithNav>} />
        <Route path="/agents" element={<WithNav><AgentManager /></WithNav>} />
        <Route path="/workflows" element={<WithNav><WorkflowManager /></WithNav>} />
        <Route path="/skills" element={<WithNav><SkillManager /></WithNav>} />
      </Routes>
    </BrowserRouter>
  );
}
