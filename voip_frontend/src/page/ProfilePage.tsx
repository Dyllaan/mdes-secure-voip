import ChangePasswordPage from '@/components/auth/forms/ChangePassword';
import { useAuth } from "@/hooks/auth/useAuth";

import ManageMfa from '@/components/auth/forms/ManageMfa';
import Logout from '@/components/auth/Logout';
import Page from '@/components/layout/Page';
import DeleteAccount from '@/components/auth/forms/DeleteAccount';
import Back from '@/components/layout/Back';

export default function ProfilePage() {
  const { user, deleteUser } = useAuth();

  return (
    <Page header footer>
      <Back />
      <div className="flex flex-col gap-6">
          <ManageMfa />
          <ChangePasswordPage />
          <DeleteAccount user={user} deleteUser={deleteUser} />
          <Logout />
      </div>
    </Page>
  );
}
