import {Lock, User as UserIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import useLoginForm from '@/hooks/auth/useLoginForm';

export default function LoginForm() {

  const { username, setUsername, password, setPassword, loading, handleSubmit } = useLoginForm();

  return (
    <form className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="username" className="flex items-center gap-2 text-base">
          <UserIcon className="w-4 h-4 text-muted-foreground" />
          Username
        </Label>
        <Input
          id="username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Enter your username"
          className="text-base h-12"
          required
          disabled={loading}
          autoComplete="username"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password" className="flex items-center gap-2 text-base">
          <Lock className="w-4 h-4 text-muted-foreground" />
          Password
        </Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter your password"
          className="text-base h-12"
          required
          disabled={loading}
          autoComplete="current-password"
        />
      </div>

      <Button
        type="submit"
        disabled={loading}
        className="w-full mt-6"
        onClick={handleSubmit}
      >
        {loading ? 'Signing in...' : 'Sign In'}
      </Button>
    </form>
  );
}