import { useState } from 'react';
import { Lock } from 'lucide-react';
import Section from '@/components/layout/Section';
import RequiresMfaVerificationDialog from '@/components/auth/dialog/RequiresMfaVerificationDialog';
import UnifiedItem from '@/components/layout/section/UnifiedItem';
import type { User } from '@/types/User';

export default function DeleteAccount({user, deleteUser} : {user?: User | null, deleteUser: (userCode: string) => Promise<void>}) {

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const isMfaEnabled = user?.mfaEnabled || false;
  const handleDeleteAccount = async (code: string) => {
    try {
        await deleteUser(code);
    } catch (error) {
        console.error('Account deletion failed:', error);
    }
  };
      

  return (
        <Section title="Delete Account" icon={Lock} description="Permanently delete your account and all associated data. This action cannot be undone.">

            {
                isMfaEnabled ? (
                    <>
                        <UnifiedItem 
                            label="Delete Account" 
                            description="Permanently delete your account and all associated data. This action cannot be undone."
                            icon={Lock}
                            onClick={() => setShowDeleteDialog(true)}
                            destructive={true}
                        />
                        <RequiresMfaVerificationDialog
                            open={showDeleteDialog}
                            onOpenChange={setShowDeleteDialog}
                            onComplete={handleDeleteAccount}
                            isLoading={false} // You can manage loading state as needed
                        />
                    </>
                ) : (
                    <UnifiedItem 
                    label="Confirm Delete Account" 
                    description="Permanently delete your account and all associated data. This action cannot be undone."
                    icon={Lock}
                    onClick={() => handleDeleteAccount('')}
                    destructive={true}
                    />
                )
            }
        </Section>
  );
}