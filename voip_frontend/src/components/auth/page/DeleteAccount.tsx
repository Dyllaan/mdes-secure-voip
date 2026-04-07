import { useState } from 'react';
import { Lock } from 'lucide-react';
import type { User } from '@/types/User';
import UnifiedItem from '@/components/layout/UnifiedItem';
import RequiresMfaVerificationDialog from '../dialog/RequiresMfaVerificationDialog';

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
      

  if (isMfaEnabled) { 
    return (
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
                isLoading={false}
            />
        </>
    );
}

    return (
        <UnifiedItem 
        label="Confirm Delete Account" 
        description="Permanently delete your account and all associated data. This action cannot be undone."
        icon={Lock}
        onClick={() => handleDeleteAccount('')}
        destructive={true}
        />
  );
}