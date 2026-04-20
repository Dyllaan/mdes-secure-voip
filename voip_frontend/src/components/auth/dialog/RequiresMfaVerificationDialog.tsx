import { useState } from 'react';
import { Shield } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import MfaCodeInput from '../MfaCodeInput';

interface RequiresMfaVerificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: (code: string) => void;
  isLoading: boolean;
}

export default function RequiresMfaVerificationDialog({ 
  open, 
  onOpenChange, 
  onComplete,
  isLoading
}: RequiresMfaVerificationDialogProps) {
  const [verificationCode, setVerificationCode] = useState('');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Multi-Factor Authentication Required
          </DialogTitle>
          <DialogDescription>
            To proceed, please enter the verification code from your authenticator app.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-4">
          <div className="space-y-2">
              <MfaCodeInput
                verificationCode={verificationCode}
                setVerificationCode={setVerificationCode}
                isLoading={isLoading}
              />
          </div>

            <Button
              onClick={() => onComplete(verificationCode)}
              disabled={isLoading || verificationCode.length !== 6}
              className="w-full bg-destructive hover:bg-destructive/90"
              type="button"
            >
              {isLoading ? 'Verifying...' : 'Verify & Delete Account'}
            </Button>
          </div>
      </DialogContent>
    </Dialog>
  );

}