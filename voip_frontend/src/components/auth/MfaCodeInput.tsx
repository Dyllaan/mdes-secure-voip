import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
export default function MfaCodeInput({verificationCode, setVerificationCode, isLoading}: {
    verificationCode: string;
    setVerificationCode: (code: string) => void;
    isLoading: boolean;
}) {
    return (
        <div className="space-y-2">
            <Label htmlFor="verifyCode">Enter 6-digit code from Authenticator app</Label>
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
    );
}