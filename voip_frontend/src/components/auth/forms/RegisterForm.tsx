import { useState } from 'react';
import { Lock, User as UserIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import axios from 'axios';
import MfaSetupDialog from '@/components/auth/dialog/MfaSetupDialog';
import { useAuth } from '@/hooks/useAuth';
import type { User } from '@/types/User';
import config from '@/config/config';

interface RegisterFormProps {
  onSuccess: () => void;
  onToggleMode: () => void;
}

export default function RegisterForm({ onSuccess, onToggleMode }: RegisterFormProps) {
  const { setUser } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showMfaSetup, setShowMfaSetup] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }

    setIsLoading(true);
    
    try {
      const response = await axios.post(`${config.AUTH_URL}/user/register`, {
        username,
        password
      });

      if (response.data.success) {
        const userData = response.data as User;
        setUser(userData);
        
        toast.success('Account created successfully!');
        
        setShowMfaSetup(true);
      } else {
        const errorData = response.data as { cause?: string };
        toast.error(errorData.cause || 'Registration failed');
      }
    } catch (error) {
      console.error('Registration failed:', error);
      toast.error('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  }

  const handleMfaSetupComplete = () => {
    onSuccess();
  };

  const handleSkipMfa = () => {
    setShowMfaSetup(false);
    onSuccess();
  };

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4 pt-4 w-96 mx-auto border p-6 rounded-lg shadow-md bg-card">
        {/* Username Field */}
        <div className="space-y-2">
          <Label htmlFor="username" className="flex items-center gap-2">
            <UserIcon className="w-4 h-4 text-muted-foreground" />
            Username
          </Label>
          <Input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Choose a username"
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
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Create a password"
            required
            disabled={isLoading}
            autoComplete="new-password"
            minLength={8}
          />
        </div>

        {/* Confirm Password Field */}
        <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
          <Label htmlFor="confirmPassword" className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-muted-foreground" />
            Confirm Password
          </Label>
          <Input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm your password"
            required
            disabled={isLoading}
            autoComplete="new-password"
          />
        </div>

        {/* Submit Button */}
        <Button
          type="submit"
          disabled={isLoading}
          className="w-full mt-6"
        >
          {isLoading ? 'Creating account...' : 'Create Account'}
        </Button>

        {/* Toggle to Login */}
        <div className="pt-4 text-center">
          <button
            type="button"
            onClick={onToggleMode}
            disabled={isLoading}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Already have an account?{' '}
            <span className="text-primary font-medium">Sign in</span>
          </button>
        </div>
      </form>

      {/* MFA Setup Dialog after registration */}
      <MfaSetupDialog
        open={showMfaSetup}
        onOpenChange={(open) => {
          if (!open) handleSkipMfa();
        }}
        onComplete={handleMfaSetupComplete}
      />
    </>
  );
}