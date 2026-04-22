import { useState } from 'react';
import { Lock } from 'lucide-react';
import type { User } from '@/types/User';
import UnifiedItem from '@/components/layout/UnifiedItem';
import RequiresMfaVerificationDialog from '../dialog/RequiresMfaVerificationDialog';
import { type ValidationResult } from '@/utils/validation/Validator';
import { toast } from 'sonner';

export default function DeleteAccount({user, deleteUser} : {user?: User | null, deleteUser: (userCode: string) => Promise<void>}) {

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const isMfaEnabled = user?.mfaEnabled || false;

  const handleDeleteAccount = async (mfaCode: string) => {
    const validationErrors: ValidationResult[] = [];
    
      if (mfaCode.length > 0 && mfaCode.length < 6) {
        validationErrors.push({ valid: false, errors: [`Code must be 6 digits (${mfaCode.length}/6 entered)`] });
      }
    
      if (mfaCode.length > 0 && !/^\d+$/.test(mfaCode)) {
        validationErrors.push({ valid: false, errors: ['Code must contain numbers only'] });
      }
    try {
        await deleteUser(mfaCode);
    } catch (error) {
        toast.error("Failed to delete account. Please try again later.");
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