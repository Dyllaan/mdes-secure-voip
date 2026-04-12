import { useState } from 'react';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { useAuth } from "@/hooks/auth/useAuth";

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface MfaFormProps {
  onSuccess: () => void;
}

export default function MfaForm({ onSuccess }: MfaFormProps) {
  const [mfaCode, setMfaCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { verifyMfa, logout } = useAuth();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    
    try {
      const result = await verifyMfa(mfaCode, trustDevice);
      
      if (result.success) {
        onSuccess();
      } else {
        toast.error(result.error || 'Invalid authentication code');
        setMfaCode('');
      }
    } catch (error) {
      console.error('MFA verification failed:', error);
      toast.error('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  }

  const handleBack = () => {
    logout();
  };

  return (
      <form onSubmit={handleSubmit} className="space-y-4 pt-4">
        {/* MFA Code Input */}
        <div className="space-y-2">
          <Label htmlFor="mfaCode" className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-muted-foreground" />
            Authentication Code
          </Label>
          <Input
            id="mfaCode"
            type="text"
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            required
            disabled={isLoading}
            maxLength={8}
            autoComplete="one-time-code"
            autoFocus
            className="text-center text-2xl tracking-widest font-mono"
          />
        </div>

        {/* Trust Device Checkbox */}
        <div className="flex items-center space-x-2 pt-2">
          <Checkbox 
            id="trustDevice" 
            checked={trustDevice}
            onCheckedChange={(checked: boolean) => setTrustDevice(checked as boolean)}
            disabled={isLoading}
          />
          <label
            htmlFor="trustDevice"
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
          >
            Trust this device for 30 days
          </label>
        </div>

        {/* Info Card */}
        <Card className="bg-muted/50 border-muted">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Need help?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <p>• Enter your 6-digit TOTP code from your authenticator app</p>
            <p>• Or use one of your 8-digit backup codes</p>
            <p>• Codes refresh every 30 seconds</p>
          </CardContent>
        </Card>

        {/* Submit Button */}
        <Button
          type="submit"
          disabled={isLoading || mfaCode.length < 6}
          className="w-full mt-6"
        >
          {isLoading ? 'Verifying...' : 'Verify Code'}
        </Button>

        {/* Back to Login */}
        <Button
          type="button"
          variant="ghost"
          onClick={handleBack}
          disabled={isLoading}
          className="w-full"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Login
        </Button>
      </form>
  );
}