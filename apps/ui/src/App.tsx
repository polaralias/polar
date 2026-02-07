import { NavLink, Route, Routes } from 'react-router-dom';
import ChatPage from './pages/ChatPage.js';
import AuditPage from './pages/AuditPage.js';
import PermissionsPage from './pages/PermissionsPage.js';
import SkillsPage from './pages/SkillsPage.js';
import MemoryPage from './pages/MemoryPage.js';
import { AgentsPage } from './pages/AgentsPage.js';
import OverviewPage from './pages/OverviewPage.js';
import DiagnosticsPage from './pages/DiagnosticsPage.js';
import ChannelsPage from './pages/ChannelsPage.js';
import IntelligencePage from './pages/IntelligencePage.js';
import PersonalizationPage from './pages/PersonalizationPage.js';

const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : '');

export default function App() {
  return (
    <div className="container">
      <div className="app-shell">
        <header className="header">
          <div className="brand">
            <h1>Polar Control</h1>
            <span>Secure runtime orchestration &amp; audit trail</span>
          </div>
          <nav className="nav">
            <NavLink to="/" end className={navClass}>
              Overview
            </NavLink>
            <NavLink to="/chat" className={navClass}>
              Chat
            </NavLink>
            <NavLink to="/agents" className={navClass}>
              Agents
            </NavLink>
            <NavLink to="/skills" className={navClass}>
              Skills
            </NavLink>
            <NavLink to="/memory" className={navClass}>
              Memory
            </NavLink>
            <NavLink to="/permissions" className={navClass}>
              Permissions
            </NavLink>
            <NavLink to="/audit" className={navClass}>
              Audit
            </NavLink>
            <NavLink to="/channels" className={navClass}>
              Channels
            </NavLink>
            <NavLink to="/intelligence" className={navClass}>
              Intelligence
            </NavLink>
            <NavLink to="/personalization" className={navClass}>
              Personalization
            </NavLink>
            <NavLink to="/diagnostics" className={navClass}>
              Doctor
            </NavLink>
          </nav>
        </header>

        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/permissions" element={<PermissionsPage />} />
          <Route path="/agents" element={<AgentsPageWrapper />} />
          <Route path="/channels" element={<ChannelsPage />} />
          <Route path="/intelligence" element={<IntelligencePage />} />
          <Route path="/personalization" element={<PersonalizationPage />} />
          <Route path="/diagnostics" element={<DiagnosticsPage />} />
        </Routes>
      </div>
    </div>
  );
}

function AgentsPageWrapper() {
  const stored = localStorage.getItem('polar-session');
  const sessionId = stored ? JSON.parse(stored).id : 'none';
  return <AgentsPage sessionId={sessionId} />;
}
