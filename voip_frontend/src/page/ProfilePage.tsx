import ChangePasswordPage from '@/components/auth/page/ChangePassword';
import { useAuth } from "@/hooks/auth/useAuth";

import ManageMfa from '@/components/auth/page/ManageMfa';
import Logout from '@/components/auth/Logout';
import Page from '@/components/layout/Page';
import DeleteAccount from '@/components/auth/page/DeleteAccount';

export default function ProfilePage() {
  const { user, deleteUser } = useAuth();

  return (
    <Page header footer>
        <div className="flex flex-col gap-6">
            <ManageMfa />
            <ChangePasswordPage />
            <DeleteAccount user={user} deleteUser={deleteUser} />
            <Logout />
        </div>
    </Page>
  );
}
