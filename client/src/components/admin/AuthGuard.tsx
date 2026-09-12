import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { ReactNode } from 'react';

interface AuthGuardProps {
  allowedRoles?: string[];
  children?: ReactNode;
  redirectTo?: string;
}

export default function AuthGuard({ allowedRoles, children, redirectTo = '/login' }: AuthGuardProps) {
  const location = useLocation();
  const { user, authEnabled, loading } = useAuthStore();

  // Still checking auth status
  if (loading || authEnabled === null) {
    return <div className="flex items-center justify-center h-screen text-gray-400">Loading...</div>;
  }

  // Auth disabled — open access
  if (!authEnabled) {
    return children ? <>{children}</> : <Outlet />;
  }

  // Auth enabled but not logged in
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  // Role check — supports multi-role (user has any of the allowed roles)
  if (allowedRoles && user) {
    const userRoles = Array.isArray(user.roles) && user.roles.length > 0
      ? user.roles
      : [user.role || (user.isAdmin ? 'admin' : 'student')];
    const hasMatch = userRoles.some((r) => allowedRoles.includes(r));
    if (!hasMatch) {
      return <Navigate to={redirectTo} replace />;
    }
  }

  return children ? <>{children}</> : <Outlet />;
}
