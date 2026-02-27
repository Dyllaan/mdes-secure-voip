import UnifiedItem from '@/components/layout/UnifiedItem';
import { Shield } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useState } from 'react';
import MfaSetupDialog from '@/components/auth/dialog/MfaSetupDialog';
import { useEffect } from 'react';
import MfaDisableDialog from '../dialog/MfaDisableDialog';

export default function ManageMfa() {
    const { user } = useAuth();
    const [showMfaSetup, setShowMfaSetup] = useState(false);
    const [showMfaDisable, setShowMfaDisable] = useState(false);
    const mfaEnabled = user?.mfaEnabled || false;

    useEffect(() => {
        console.log("MFA Enabled Status:", mfaEnabled);
        console.log("User Data:", user);
    }, [mfaEnabled, user]);

    return (
        <div title="Multi-Factor Authentication">
            <UnifiedItem 
                label={mfaEnabled ? "MFA is Enabled" : "MFA is Disabled"} 
                description={mfaEnabled ? "Multi-factor authentication is currently enabled on your account." : "Please enable MFA for added security."}
                icon={Shield}
                onClick={!mfaEnabled ? () => setShowMfaSetup(true) : () => setShowMfaDisable(true)}
            />
            <MfaSetupDialog
                    open={showMfaSetup}
                    onOpenChange={setShowMfaSetup}
                    onComplete={() => setShowMfaSetup(false)}
                />

            <MfaDisableDialog
                    open={showMfaDisable}
                    onOpenChange={setShowMfaDisable}
                    onComplete={() => setShowMfaDisable(false)}
                />
        </div>
    );
}