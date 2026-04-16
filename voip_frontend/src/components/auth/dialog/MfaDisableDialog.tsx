import { Shield } from 'lucide-react';
import { useAuth } from "@/hooks/auth/useAuth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import Errors from '@/components/layout/Errors';
import MfaCodeInput from '../MfaCodeInput';
import useMfaCode from '@/hooks/auth/useMfaCode';

interface MfaDisableDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function MfaDisableDialog({ open, onOpenChange }: MfaDisableDialogProps) {
  const { disableMfa } = useAuth();

  const { mfaCode, handleChange, handleSubmit, errors, isValid, isLoading } = useMfaCode({
    onSubmit: async (code) => {
      try {
        await disableMfa(code);
        return { success: true };
      } catch {
        return { success: false, error: 'Failed to disable MFA. Please check your code and try again.' };
      }
    },
    onSuccess: () => onOpenChange(false),
  });

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
        <form onSubmit={handleSubmit} className="space-y-4">
          <MfaCodeInput verificationCode={mfaCode} setVerificationCode={handleChange} isLoading={isLoading} />
          <Errors errors={errors} />
          <Button
            type="submit"
            disabled={isLoading || !isValid}
            className="w-full"
          >
            Verify & Disable
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}