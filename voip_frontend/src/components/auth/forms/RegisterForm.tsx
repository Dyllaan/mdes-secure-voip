import { useState } from 'react';
import { Lock, User as UserIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import MfaSetupDialog from '@/components/auth/dialog/MfaSetupDialog';
import { useAuth } from "@/hooks/auth/useAuth";

interface RegisterFormProps {
  onSuccess: () => void;
  onToggleMode: () => void;
}

export default function RegisterForm({ onSuccess, onToggleMode }: RegisterFormProps) {
  const { register } = useAuth();
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
      const result = await register(username, password);
      
      if (result.success) {
        toast.success('Account created successfully!');
        onSuccess();
      } else if (result.mfaRequired) {
        // MFA form will be shown automatically by AuthPage
        toast.info('Please enter your authentication code');
      } else {
        toast.error(result.error || 'Registration failed');
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
      <form onSubmit={handleSubmit} className="space-y-4 pt-4 w-96 mx-auto p-6">
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
            data-testid="password-input"
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
            data-testid="confirm-password-input"
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
          data-testid="register-submit"
          disabled={isLoading}
          className="w-full mt-6"
        >
          {isLoading ? 'Creating account...' : 'Create Account'}
        </Button>

        {/* Toggle to Login */}
        <div className="pt-4 text-center">
          <button
            type="button"
            data-testid="switch-to-login"
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