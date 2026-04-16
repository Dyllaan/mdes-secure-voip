import { Lock, Save, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from "@/hooks/auth/useAuth";
import Validator, { type ValidationResult } from '@/utils/validation/Validator';
import Errors from '@/components/layout/Errors';
import MfaCodeInput from '../MfaCodeInput';

const validator = new Validator();

export default function ChangePasswordPage() {
    const { updatePassword, user } = useAuth();

    const [open, setOpen] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [mfaCode, setMfaCode] = useState('');
    const [isLoadingPassword, setIsLoadingPassword] = useState(false);
    const [showMfaInput, setShowMfaInput] = useState(false);

    const hasInteracted = !!(currentPassword || newPassword || confirmPassword);

    const validationErrors: ValidationResult[] = [];

    if (newPassword) {
        const result = validator.validate('Password', newPassword);
        if (!result.valid) validationErrors.push(result);
    }

    if (newPassword && confirmPassword && newPassword !== confirmPassword) {
        validationErrors.push({ valid: false, errors: ['New password and confirmation do not match'] });
    }

    if (user?.mfaEnabled && mfaCode.length > 0 && mfaCode.length < 6) {
        validationErrors.push({ valid: false, errors: [`MFA code must be 6 digits (${mfaCode.length}/6 entered)`] });
    }

    if (user?.mfaEnabled && mfaCode.length > 0 && !/^\d+$/.test(mfaCode)) {
        validationErrors.push({ valid: false, errors: ['MFA code must contain numbers only'] });
    }

    async function handlePasswordChange(e: React.FormEvent) {
        e.preventDefault();
        if (validationErrors.length > 0) return;

        setIsLoadingPassword(true);

        try {
            const result = await updatePassword(
                currentPassword,
                newPassword,
                user?.mfaEnabled ? mfaCode : undefined
            );

            if (result.success) {
                setCurrentPassword('');
                setNewPassword('');
                setConfirmPassword('');
                setMfaCode('');
                setShowMfaInput(false);
                setOpen(false);
            } else if (result.mfaRequired) {
                setShowMfaInput(true);
            }
        } catch (error) {
            toast.error("Failed to update password");
            console.error('Password update failed:', error);
        } finally {
            setIsLoadingPassword(false);
        }
    }

    return (
        <Collapsible open={open} onOpenChange={setOpen} className="px-3">
            <CollapsibleTrigger asChild>
                <button className="flex items-center justify-between w-full mb-4 group">
                    <div className="flex items-center gap-2">
                        <Lock className="w-5 h-5 text-muted-foreground" />
                        <h2 className="text-lg font-semibold">Change Password</h2>
                    </div>
                    <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
                </button>
            </CollapsibleTrigger>

            <CollapsibleContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                    Update your password to keep your account secure.
                </p>

                <form onSubmit={handlePasswordChange} className="space-y-4 pt-2 pb-2">
                    <div className="space-y-2">
                        <Label htmlFor="current-password">Current Password</Label>
                        <Input
                            id="current-password"
                            type="password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            placeholder="Enter current password"
                            required
                            disabled={isLoadingPassword}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="new-password">New Password</Label>
                        <Input
                            id="new-password"
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="Enter new password"
                            required
                            disabled={isLoadingPassword}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="confirm-password">Confirm New Password</Label>
                        <Input
                            id="confirm-password"
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="Confirm new password"
                            required
                            disabled={isLoadingPassword}
                        />
                    </div>

                    {user?.mfaEnabled && (
                        <MfaCodeInput
                            verificationCode={mfaCode}
                            setVerificationCode={setMfaCode}
                            isLoading={isLoadingPassword}
                        />
                    )}

                    {showMfaInput && !user?.mfaEnabled && (
                        <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                            <p className="text-sm text-blue-400">
                                MFA code is required. Please enter your authentication code and try again.
                            </p>
                        </div>
                    )}

                    {hasInteracted && <Errors errors={validationErrors} />}

                    <Button
                        type="submit"
                        disabled={isLoadingPassword || validationErrors.length > 0}
                        className="w-full"
                    >
                        <Save className="w-4 h-4 mr-2" />
                        {isLoadingPassword ? 'Updating...' : 'Update Password'}
                    </Button>
                </form>
            </CollapsibleContent>
        </Collapsible>
    );
}