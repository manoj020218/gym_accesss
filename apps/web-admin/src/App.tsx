import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/auth';
import { Toaster } from './components/ui/Toast';

import Login       from './pages/Login';
import Dashboard   from './pages/Dashboard';
import MembersList from './pages/Members/index';
import MemberDetail from './pages/Members/MemberDetail';
import AccessMonitor from './pages/AccessMonitor';
import Billing     from './pages/Billing/index';
import StaffList   from './pages/Staff/index';
import ProductsList from './pages/Products/index';
import Reports     from './pages/Reports';
import Settings    from './pages/Settings';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  return token ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/members" element={<RequireAuth><MembersList /></RequireAuth>} />
        <Route path="/members/:id" element={<RequireAuth><MemberDetail /></RequireAuth>} />
        <Route path="/access" element={<RequireAuth><AccessMonitor /></RequireAuth>} />
        <Route path="/billing" element={<RequireAuth><Billing /></RequireAuth>} />
        <Route path="/staff" element={<RequireAuth><StaffList /></RequireAuth>} />
        <Route path="/products" element={<RequireAuth><ProductsList /></RequireAuth>} />
        <Route path="/reports" element={<RequireAuth><Reports /></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      <Toaster />
    </>
  );
}
