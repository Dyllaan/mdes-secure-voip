import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from "@/hooks/auth/useAuth";


export default function PublicRoute() {
  const { signedIn, isLoading } = useAuth();
  if (isLoading) return null;
  if (signedIn) return <Navigate to="/hub-list" replace />;
  return <Outlet />;
}