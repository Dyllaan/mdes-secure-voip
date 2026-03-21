import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import LoginForm from '@/components/auth/forms/LoginForm';
import RegisterForm from '@/components/auth/forms/RegisterForm';
import MfaForm from '@/components/auth/forms/MfaForm';
import Page from "@/components/layout/Page";

export default function AuthPage({ mode = 'login' }: { mode?: 'login' | 'register' }) {
  const [isLogin, setIsLogin] = useState(mode === 'login');
  const { mfaRequired } = useAuth();
  const navigate = useNavigate();

  const toggleAuthMode = () => {
    setIsLogin(!isLogin);
  };

  const handleAuthSuccess = () => {
    navigate('/');
  }

  if (mfaRequired) {
    return (
      <div className="bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6">
          <MfaForm onSuccess={handleAuthSuccess} />
        </div>
      </div>
    );
  }

  return (
    <Page title={isLogin ? "Login" : "Register"} subtitle="Access your account or create a new one to get started.">
      {isLogin ? (
        <LoginForm 
          onSuccess={handleAuthSuccess}
          onToggleMode={toggleAuthMode}
        />
      ) : (
        <RegisterForm 
          onSuccess={handleAuthSuccess}
          onToggleMode={toggleAuthMode}
        />
      )}
    </Page>
  );
}