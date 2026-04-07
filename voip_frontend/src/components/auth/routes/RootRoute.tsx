
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import Landing from '@/page/Landing';
const isElectron = window.electronAPI || (() => {
  try {
    return navigator.userAgent.includes('Electron');
  } catch {
    return false;
  }
})();

export default function RootRoute() {
  const { signedIn, isLoading } = useAuth();
  if (isLoading) return null;
  if (isElectron) return <Navigate to="/login" replace />;
  if (signedIn) return <Navigate to="/hub-list" replace />;
  return <Landing />;
}