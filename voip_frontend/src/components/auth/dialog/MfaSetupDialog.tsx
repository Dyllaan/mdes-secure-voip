import { useState } from 'react';
import { Shield, Copy, Check, Download } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import axios from 'axios';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from '@/components/ui/badge';
import type { MfaSetupResponse } from '@/types/dto/MfaResponses';
import MfaCodeInput from '../MfaCodeInput';
import config from '@/config/config';

interface MfaSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

export default function MfaSetupDialog({ 
  open, 
  onOpenChange, 
  onComplete,
}: MfaSetupDialogProps) {
  const [step, setStep] = useState<'setup' | 'verify' | 'backup'>('setup');
  const [setupData, setSetupData] = useState<MfaSetupResponse | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [secretCopied, setSecretCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { user, fetchMfaStatus, changeUserIsMfaEnabled } = useAuth();

  const accessToken = user?.accessToken;
  

  const handleSetupMfa = async () => {
    if (!accessToken) {
      toast.error('Please login first');
      return;
    }

    setIsLoading(true);
    try {
      const response = await axios.post(`${config.AUTH_URL}/mfa/setup`, {}, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      setSetupData(response.data as MfaSetupResponse);
      setStep('verify');
      toast.success('MFA setup initiated');
    } catch (error) {
      console.error('MFA setup failed:', error);
      if (axios.isAxiosError(error) && error.response?.data?.cause) {
        toast.error(error.response.data.cause);
      } else {
        toast.error('An unexpected error occurred');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!accessToken || !verificationCode) return;

    setIsLoading(true);
    try {
      await axios.post(`${config.AUTH_URL}/mfa/verify`, {
        code: verificationCode
      }, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      toast.success('MFA enabled successfully!');
      changeUserIsMfaEnabled(true);
      setStep('backup');
      await fetchMfaStatus();
    } catch (error) {
      console.error('MFA verification failed:', error);
      if (axios.isAxiosError(error) && error.response?.data?.cause) {
        toast.error(error.response.data.cause);
      } else {
        toast.error('Invalid verification code');
      }
      setVerificationCode('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopySecret = () => {
    if (setupData?.secret) {
      navigator.clipboard.writeText(setupData.secret);
      setSecretCopied(true);
      toast.success('Secret copied to clipboard');
      setTimeout(() => setSecretCopied(false), 2000);
    }
  };

  const handleDownloadBackupCodes = () => {
    if (!setupData?.backupCodes) return;

    const content = `Talk Backup Codes\nGenerated: ${new Date().toLocaleString()}\n\n${setupData.backupCodes.join('\n')}\n\nKeep these codes safe. Each code can only be used once.`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'talk-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Backup codes downloaded');
  };

  const handleComplete = () => {
    onOpenChange(false);
    setStep('setup');
    setSetupData(null);
    setVerificationCode('');
    onComplete?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Enable Two-Factor Authentication
          </DialogTitle>
          <DialogDescription>
            {step === 'setup' && 'Secure your account with an authenticator app'}
            {step === 'verify' && 'Scan the QR code and enter your verification code'}
            {step === 'backup' && 'Save your backup codes in a secure location'}
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Introduction */}
        {step === 'setup' && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">What you'll need</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>• An authenticator app (Google Authenticator, Authy, etc.)</p>
                <p>• Your phone or tablet</p>
                <p>• A secure place to store backup codes</p>
              </CardContent>
            </Card>

            <Button
              onClick={() => {
                console.log('Continue button clicked');
                handleSetupMfa();
              }}
              disabled={isLoading || !accessToken}
              className="w-full"
              type="button"
            >
              {isLoading ? 'Setting up...' : 'Continue'}
            </Button>
            
            {/* Debug info - remove after fixing */}
            {!accessToken && (
              <p className="text-xs text-red-500 text-center">
                No access token available
              </p>
            )}
          </div>
        )}

        {/* Step 2: Scan QR & Verify */}
        {step === 'verify' && setupData && (
          <div className="space-y-4">
            {/* QR Code */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Scan QR Code</CardTitle>
                <CardDescription>
                  Open your authenticator app and scan this code
                </CardDescription>
              </CardHeader>
              <CardContent className="flex justify-center">
                <img 
                  src={setupData.qrCode} 
                  alt="QR Code" 
                  className="w-48 h-48 border rounded-lg"
                />
              </CardContent>
            </Card>

            {/* Manual Entry Option */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Or enter manually</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 bg-muted rounded text-sm font-mono break-all">
                    {setupData.secret}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleCopySecret}
                    type="button"
                  >
                    {secretCopied ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Verification Code Input */}
            <MfaCodeInput verificationCode={verificationCode} setVerificationCode={setVerificationCode} isLoading={isLoading} />

            <Button
              onClick={handleVerifyCode}
              disabled={isLoading || verificationCode.length !== 6}
              className="w-full"
              type="button"
            >
              {isLoading ? 'Verifying...' : 'Verify & Enable'}
            </Button>
          </div>
        )}

        {/* Step 3: Backup Codes */}
        {step === 'backup' && setupData && (
          <div className="space-y-4">
            <Card className="border-yellow-500/50 bg-yellow-500/10">
              <CardHeader>
                <CardTitle className="text-base text-yellow-600 dark:text-yellow-500">
                  Important: Save Your Backup Codes
                </CardTitle>
                <CardDescription>
                  These codes can be used to access your account if you lose your authenticator device
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2">
                  {setupData.backupCodes.map((code, index) => (
                    <Badge 
                      key={index} 
                      variant="outline" 
                      className="justify-center py-2 font-mono"
                    >
                      {code}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="flex gap-2">
              <Button
                onClick={handleDownloadBackupCodes}
                variant="outline"
                className="flex-1"
                type="button"
              >
                <Download className="w-4 h-4 mr-2" />
                Download
              </Button>
              <Button
                onClick={handleComplete}
                className="flex-1"
                type="button"
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}