import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from "@/hooks/auth/useAuth";


export default function ProtectedRoute() {
  const { signedIn, isLoading } = useAuth();
  if (isLoading) return null;
  if (!signedIn) return <Navigate to="/login" replace />;
  return <Outlet />;
}