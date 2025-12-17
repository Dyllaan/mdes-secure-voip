import Dashboard from '@/page/Dashboard';
import { Login } from '@/page/Login';
import { useAuth } from '@/hooks/useAuth';

export default function LoginOrDash() {
  const { isAuthenticated } = useAuth();
    return isAuthenticated ? <Dashboard /> : <Login />;
}