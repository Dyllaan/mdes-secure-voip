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
              <Label htmlFor="verifyCode">Enter 6-digit code</Label>
              <Input
                id="verifyCode"
                type="text"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                maxLength={6}
                disabled={isLoading}
                className="text-center text-2xl tracking-widest font-mono"
                autoFocus
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