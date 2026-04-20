import { useState } from 'react';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { useAuth } from "@/hooks/auth/useAuth";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Errors from '@/components/layout/Errors';
import useMfaCode from '@/hooks/auth/useMfaCode';
import MfaCodeInput from '../MfaCodeInput';

interface MfaFormProps {
  onSuccess: () => void;
}

export default function MfaForm({ onSuccess }: MfaFormProps) {
  const [trustDevice, setTrustDevice] = useState(false);
  const { verifyMfa, logout } = useAuth();
  const { mfaCode, handleSubmit, handleChange, errors, isValid, isLoading } = useMfaCode({
    onSubmit: verifyMfa,
    trustDevice,
    onSuccess,
  });

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4 pt-4">
        <div className="space-y-2">
          <MfaCodeInput
            verificationCode={mfaCode}
            setVerificationCode={handleChange}
            isLoading={isLoading}
          />
        </div>
        <div className="flex items-center space-x-2 pt-2">
          <Checkbox
            id="trustDevice"
            checked={trustDevice}
            onCheckedChange={(checked) => setTrustDevice(checked as boolean)}
            disabled={isLoading}
          />
          <label
            htmlFor="trustDevice"
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
          >
            Trust this device for 30 days
          </label>
        </div>
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
        <Button
          type="submit"
          disabled={isLoading || !isValid}
          className="w-full mt-6"
        >
          {isLoading ? 'Verifying...' : 'Verify Code'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={logout}
          disabled={isLoading}
          className="w-full"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Login
        </Button>
      </form>
      <Errors errors={errors} />
    </>
  );
}