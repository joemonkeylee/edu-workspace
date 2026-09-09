import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';

interface AuthGuardProps {
  allowedRoles?: string[];
}

export default function AuthGuard({ allowedRoles }: AuthGuardProps) {
  const location = useLocation();
  const { user, authEnabled, loading } = useAuthStore();

  // Still checking auth status
  if (loading || authEnabled === null) {
    return <div className="flex items-center justify-center h-screen text-gray-400">Loading...</div>;
  }

  // Auth disabled — open access
  if (!authEnabled) {
    return <Outlet />;
  }

  // Auth enabled but not logged in
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  // Role check
  if (allowedRoles && user) {
    const role = user.isAdmin ? 'admin' : 'user';
    if (!allowedRoles.includes(role)) {
      return <Navigate to="/" replace />;
    }
  }

  return <Outlet />;
}
