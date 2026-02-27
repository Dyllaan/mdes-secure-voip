import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

export default function PublicRoute() {
  const { signedIn } = useAuth();
  
  if (signedIn) {
    return <Navigate to="/" replace />;
  }
  
  return <Outlet />;
}