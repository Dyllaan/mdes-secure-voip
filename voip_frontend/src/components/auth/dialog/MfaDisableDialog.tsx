import { useState } from 'react';
import { Shield } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import MfaCodeInput from '../MfaCodeInput';

interface MfaDisableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

export default function MfaDisableDialog({ 
  open, 
  onOpenChange, 
}: MfaDisableDialogProps) {
  const [verificationCode, setVerificationCode] = useState('');
  const { disableMfa } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

    const handleDisableMfa = async () => {
        setIsLoading(true);
        try {
            await disableMfa(verificationCode);
            setVerificationCode('');
            onOpenChange(false);
        } catch {
            toast.error('Failed to disable MFA. Please check your code and try again.');
        } finally {
            setIsLoading(false);
        }
    }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Disable Two-Factor Authentication
          </DialogTitle>
          <DialogDescription>
             Enter your verification code
          </DialogDescription>
        </DialogHeader>
          <div className="space-y-4">
            <MfaCodeInput verificationCode={verificationCode} setVerificationCode={setVerificationCode} isLoading={isLoading} />

            <Button
              onClick={handleDisableMfa}
              disabled={isLoading || verificationCode.length !== 6}
              className="w-full"
              type="button"
            >
              Verify & Disable
            </Button>
          </div>
      </DialogContent>
    </Dialog>
  );
}