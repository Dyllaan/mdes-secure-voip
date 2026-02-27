import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

export default function ProtectedRoute() {
  const { signedIn } = useAuth();
  
  if (!signedIn) {
    return <Navigate to="/login" replace />;
  }
  
  return <Outlet />;
}