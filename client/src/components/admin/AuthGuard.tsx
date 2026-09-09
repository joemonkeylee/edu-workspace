import { Navigate, Outlet, useLocation } from 'react-router-dom';

interface AuthGuardProps {
  allowedRoles?: string[];
}

const FALLBACK_ROUTE = '/';

export default function AuthGuard({ allowedRoles }: AuthGuardProps) {
  const location = useLocation();

  // TODO: Replace with real auth check once user system is in place.
  // Example:
  //   const { user } = useAuthStore();
  //   if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  //   if (allowedRoles && !allowedRoles.includes(user.role)) {
  //     return <Navigate to={FALLBACK_ROUTE} replace />;
  //   }

  // Currently open access — no auth required.
  // Add `allowedRoles={['admin', 'editor']}` on the route element to gate it later.
  void allowedRoles;
  void location;

  return <Outlet />;
}
