import type { User, MfaStatus, LoginResult } from '@/types/User';

export type AuthContextType = {
  user: User | null;
  setUser: (user: User | null) => void;
  login: (username: string, password: string, mfaCode?: string, trustDevice?: boolean) => Promise<LoginResult>;
  verifyMfa: (mfaCode: string, trustDevice: boolean) => Promise<LoginResult>;
  logout: () => void;
  signedIn: boolean;
  mfaRequired: boolean;
  pendingMfaToken: string | null;
  mfaStatus: MfaStatus | null;
  fetchMfaStatus: () => Promise<void>;
  deleteUser: (mfaCode: string) => Promise<void>;
  disableMfa: (mfaCode: string) => Promise<void>;
  changeUserIsMfaEnabled: (enabled: boolean) => void;
  updatePassword: (oldPassword: string, newPassword: string, mfaCode?: string) => Promise<{ success: boolean; mfaRequired?: boolean; error?: string }>;
  isLoading: boolean;
  turnCredentials: { username: string; password: string; ttl: number } | null;
  register: (username: string, password: string) => Promise<LoginResult>;
}