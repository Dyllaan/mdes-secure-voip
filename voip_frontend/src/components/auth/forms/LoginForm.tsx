import { useState } from 'react';
import { Lock, User as UserIcon } from 'lucide-react';
import { useAuth } from "@/hooks/auth/useAuth";

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

interface LoginFormProps {
  onSuccess: () => void;
  onToggleMode: () => void;
}

export default function LoginForm({ onSuccess, onToggleMode }: LoginFormProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    
    try {
      const result = await login(username, password);
      
      if (result.success) {
        toast.success('Login successful!');
        onSuccess();
      } else if (result.mfaRequired) {
        // MFA form will be shown automatically by AuthPage
        toast.info('Please enter your authentication code');
      } else {
        toast.error(result.error || 'Login failed');
      }
    } catch (error) {
      console.error('Login failed:', error);
      toast.error('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form data-testid="login-form" onSubmit={handleSubmit} className="space-y-4 pt-4 w-96 mx-auto p-6">
      {/* Username Field */}
      <div className="space-y-2">
        <Label htmlFor="username" className="flex items-center gap-2">
          <UserIcon className="w-4 h-4 text-muted-foreground" />
          Username
        </Label>
        <Input
          id="username"
          data-testid="username-input"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Enter your username"
          required
          disabled={isLoading}
          autoComplete="username"
        />
      </div>

      {/* Password Field */}
      <div className="space-y-2">
        <Label htmlFor="password" className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-muted-foreground" />
          Password
        </Label>
        <Input
          id="password"
          data-testid="password-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter your password"
          required
          disabled={isLoading}
          autoComplete="current-password"
        />
      </div>

      {/* Submit Button */}
      <Button
        type="submit"
        data-testid="login-submit"
        disabled={isLoading}
        className="w-full mt-6"
      >
        {isLoading ? 'Signing in...' : 'Sign In'}
      </Button>

      {/* Toggle to Register */}
      <div className="pt-4 text-center">
        <button
          type="button"
          data-testid="switch-to-register"
          onClick={onToggleMode}
          disabled={isLoading}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Don't have an account?{' '}
          <span className="text-primary font-medium">Sign up</span>
        </button>
      </div>
    </form>
  );
}