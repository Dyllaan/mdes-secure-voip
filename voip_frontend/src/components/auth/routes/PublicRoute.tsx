import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

export default function PublicRoute() {
  const { signedIn, isLoading } = useAuth();
  console.log('PublicRoute', { signedIn, isLoading });
  if (isLoading) return null;
  if (signedIn) return <Navigate to="/hub-list" replace />;
  return <Outlet />;
}