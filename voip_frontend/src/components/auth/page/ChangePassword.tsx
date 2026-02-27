import { Lock, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Section from '@/components/layout/Section';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import MfaCodeInput from '../MfaCodeInput';

export default function ChangePasswordPage() {
    const { updatePassword, user } = useAuth();
    
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [mfaCode, setMfaCode] = useState('');
    const [isLoadingPassword, setIsLoadingPassword] = useState(false);
    const [showMfaInput, setShowMfaInput] = useState(false);

    async function handlePasswordChange(e: React.FormEvent) {
        e.preventDefault();
        
        if (newPassword !== confirmPassword) {
            toast.error("New password and confirmation do not match");
            return;
        }

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
        <Section 
            icon={Lock} 
            title="Change Password" 
            description="Update your password to keep your account secure."
        >
            <form onSubmit={handlePasswordChange} className="space-y-4 pt-4">
                <div className="space-y-2">
                    <label htmlFor="current-password" className="text-sm font-medium text-foreground flex items-center gap-2">
                        <Lock className="w-4 h-4 text-muted-foreground" />
                        Current Password
                    </label>
                    <input
                        id="current-password"
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="Enter current password"
                        required
                        disabled={isLoadingPassword}
                        className="w-full px-4 py-2 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    />
                </div>

                <div className="space-y-2">
                    <label htmlFor="new-password" className="text-sm font-medium text-foreground flex items-center gap-2">
                        <Lock className="w-4 h-4 text-muted-foreground" />
                        New Password
                    </label>
                    <input
                        id="new-password"
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Enter new password"
                        required
                        disabled={isLoadingPassword}
                        className="w-full px-4 py-2 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    />
                </div>

                <div className="space-y-2">
                    <label htmlFor="confirm-password" className="text-sm font-medium text-foreground flex items-center gap-2">
                        <Lock className="w-4 h-4 text-muted-foreground" />
                        Confirm New Password
                    </label>
                    <input
                        id="confirm-password"
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Confirm new password"
                        required
                        disabled={isLoadingPassword}
                        className="w-full px-4 py-2 bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    />
                </div>

                {user?.mfaEnabled && (
                    <MfaCodeInput verificationCode={mfaCode} setVerificationCode={setMfaCode} isLoading={isLoadingPassword} />
                )}

                {showMfaInput && !user?.mfaEnabled && (
                    <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                        <p className="text-sm text-blue-400">
                            MFA code is required. Please enter your authentication code and try again.
                        </p>
                    </div>
                )}

                <Button
                    type="submit"
                    disabled={isLoadingPassword}
                    className="w-full"
                >
                    <Save className="w-4 h-4 mr-2" />
                    {isLoadingPassword ? 'Updating...' : 'Update Password'}
                </Button>
            </form>
        </Section>
    );
}