import Dashboard from '@/page/Dashboard';
import AuthPage from '@/page/AuthPage';
import { useAuth } from '@/hooks/useAuth';

export default function LoginOrDash() {
  const { signedIn } = useAuth();
    return signedIn ? <Dashboard /> : <AuthPage />;
}