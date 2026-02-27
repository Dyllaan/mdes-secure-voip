import { createContext, useState, useEffect } from 'react';
import { toast } from "sonner";
import useLocalStorage from '@/hooks/useLocalStorage';
import axios from 'axios';
import { getDeviceFingerprint } from '@/utils/deviceFingerprint';
import type { User, MfaStatus, LoginResult, MeResponse } from '@/types/User';
import config from '@/config/config';
type AuthContextType = {
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
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: React.ReactNode;
}

const BASE_URL = config.AUTH_URL;

export default function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useLocalStorage<User | null>('user', null);
  const [signedIn, setSignedIn] = useState(!!user);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [pendingMfaToken, setPendingMfaToken] = useState<string | null>(null);
  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);

  useEffect(() => {
    if (user?.accessToken) {
      fetchMfaStatus();
    }
  }, [user?.accessToken]);

  const changeUserIsMfaEnabled = (enabled: boolean) => {
    if (user) {
      setUser({ ...user, mfaEnabled: enabled });
    }
  };

  function logout() {
    setUser(null);
    setSignedIn(false);
    setMfaRequired(false);
    setPendingMfaToken(null);
    setMfaStatus(null);
  }

  useEffect(() => {
    checkToken().then((isValid) => {
      if (!isValid) logout();
    });
  }, []);

  const fetchMfaStatus = async () => {
    if (!user?.accessToken) return;

    const response = await axios.get(`${BASE_URL}/mfa/status`, {
      headers: { Authorization: `Bearer ${user.accessToken}` }
    });

    if (response.status === 200) {
      setMfaStatus(response.data as MfaStatus);
    }
  };

  const checkToken = async () => {
    const { accessToken, refreshToken } = user ?? {};

    if (!accessToken) {
      setSignedIn(false);
      return false;
    }

    try {
      const response = await axios.get(`${BASE_URL}/user/me`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      const responseData = response.data as MeResponse;
      changeUserIsMfaEnabled(responseData.mfaEnabled ?? false);
      setSignedIn(true);
      return true;
    } catch {
      if (refreshToken) {
        try {
          const refreshResponse = await axios.post(`${BASE_URL}/user/refresh`, { token: refreshToken });
          const userData = refreshResponse.data as User;
          setUser(userData);
          setSignedIn(true);
          setMfaStatus({ enabled: userData.mfaEnabled ?? false, verified: true });
          return true;
        } catch {
          // Refresh failed
        }
      }

      setSignedIn(false);
      return false;
    }
  };

  const login = async (username: string, password: string, mfaCode?: string, trustDevice?: boolean): Promise<LoginResult> => {
    try {
      const deviceFingerprint = await getDeviceFingerprint();
      const storedDeviceToken = localStorage.getItem('deviceToken');

      const response = await axios.post(`${BASE_URL}/user/login`, {
        username,
        password,
        deviceFingerprint,
        ...(mfaCode && { mfaCode }),
        ...(storedDeviceToken && { deviceToken: storedDeviceToken }),
        ...(trustDevice && { trustDevice })
      }, { validateStatus: () => true });

      if (response.status === 202) {
        const data = response.data as { mfaToken: string; message: string };
        setMfaRequired(true);
        setPendingMfaToken(data.mfaToken);
        toast.info('Please enter your authentication code');
        return { success: false, mfaRequired: true };
      }

      if (response.status === 200) {
        const userData = response.data as User;
        setUser(userData);
        setSignedIn(true);
        setMfaRequired(false);
        setPendingMfaToken(null);

        if (userData.deviceToken) {
          localStorage.setItem('deviceToken', userData.deviceToken);
          toast.success('Device trusted for 30 days');
        }

        return { success: true };
      }

      const errorData = response.data as { cause?: string };
      setSignedIn(false);
      toast.error(errorData.cause || 'Login failed');
      return { success: false, error: errorData.cause };

    } catch {
      toast.error('An unexpected error occurred');
      return { success: false, error: 'Network error' };
    }
  };

  const verifyMfa = async (mfaCode: string, trustDevice: boolean): Promise<LoginResult> => {
    if (!pendingMfaToken) {
      toast.error('Session expired. Please login again.');
      return { success: false, error: 'No MFA session' };
    }

    try {
      const deviceFingerprint = await getDeviceFingerprint();

      const response = await axios.post(`${BASE_URL}/user/verify-mfa`, {
        mfaToken: pendingMfaToken,
        code: mfaCode,
        deviceFingerprint,
        trustDevice
      }, { validateStatus: () => true });

      if (response.status === 200) {
        const userData = response.data as User;
        setUser(userData);
        setSignedIn(true);
        setMfaRequired(false);
        setPendingMfaToken(null);

        if (userData.deviceToken) {
          localStorage.setItem('deviceToken', userData.deviceToken);
          toast.success('Device trusted for 30 days');
        }

        toast.success('Authentication successful!');
        return { success: true };
      }

      const errorData = response.data as { cause?: string };
      toast.error(errorData.cause || 'Invalid authentication code');
      return { success: false, error: errorData.cause };

    } catch (error) {
      console.error('MFA verification failed:', error);
      toast.error('An unexpected error occurred');
      return { success: false, error: 'Network error' };
    }
  };

  const deleteUser = async (mfaCode?: string) => {
    try {
      const response = await axios.delete(`${BASE_URL}/user/delete`, {
        headers: { Authorization: `Bearer ${user?.accessToken}` },
        data: { mfaCode },
        validateStatus: () => true
      });

      if (response.status === 401) {
        toast.info('Incorrect MFA code');
      } else if (response.status === 200) {
        toast.success('User account deleted successfully');
        logout();
        setSignedIn(false);
      }

    } catch (error) {
      console.error('Delete error:', error);
      toast.error('An unexpected error occurred');
    }
  };

  const disableMfa = async (mfaCode: string) => {
    try {
      const response = await axios.post(`${BASE_URL}/mfa/disable`, { code: mfaCode }, {
        headers: { Authorization: `Bearer ${user?.accessToken}` },
        validateStatus: () => true
      });

      if (response.status === 200) {
        toast.success('MFA disabled successfully');
        changeUserIsMfaEnabled(false);
      } else {
        const errorData = response.data as { cause?: string };
        toast.error(errorData.cause || 'Failed to disable MFA');
      }
    } catch {
      toast.error('An unexpected error occurred');
    }
  };

  const updatePassword = async (oldPassword: string, newPassword: string, mfaCode?: string) => {
    try {
      const response = await axios.post(`${BASE_URL}/user/update-password`, {
        oldPassword,
        newPassword,
        ...(mfaCode && { mfaCode })
      }, {
        headers: { Authorization: `Bearer ${user?.accessToken}` },
        validateStatus: () => true
      });

      if (response.status === 400) {
        const errorData = response.data as { cause?: string };
        toast.info(errorData.cause || 'MFA code required');
        return { success: false, mfaRequired: true };
      }

      if (response.status === 200) {
        toast.success('Password updated successfully');
        return { success: true };
      }

      const errorData = response.data as { cause?: string };
      toast.error(errorData.cause || 'Failed to update password');
      return { success: false, error: errorData.cause };

    } catch {
      toast.error('An unexpected error occurred');
      return { success: false, error: 'Network error' };
    }
  };

  const contextValue: AuthContextType = {
    user,
    setUser,
    login,
    verifyMfa,
    logout,
    signedIn,
    mfaRequired,
    pendingMfaToken,
    mfaStatus,
    fetchMfaStatus,
    deleteUser,
    disableMfa,
    changeUserIsMfaEnabled,
    updatePassword
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}