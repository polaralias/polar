import { NavLink, Route, Routes } from 'react-router-dom';
import ChatPage from './pages/ChatPage';
import AuditPage from './pages/AuditPage';
import PermissionsPage from './pages/PermissionsPage';

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
              Chat
            </NavLink>
            <NavLink to="/audit" className={navClass}>
              Audit
            </NavLink>
            <NavLink to="/permissions" className={navClass}>
              Permissions
            </NavLink>
          </nav>
        </header>

        <Routes>
          <Route path="/" element={<ChatPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/permissions" element={<PermissionsPage />} />
        </Routes>
      </div>
    </div>
  );
}
