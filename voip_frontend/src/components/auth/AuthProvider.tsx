import { createContext, useState, useEffect } from 'react';
import { toast } from "sonner";
import useLocalStorage from '@/hooks/useLocalStorage';
import axios from 'axios';
import { decodeJwt } from '@/utils/jwt';
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
  isLoading: boolean;
  turnCredentials: { username: string; password: string; ttl: number } | null;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: React.ReactNode;
}

const BASE_URL = config.AUTH_URL;
const GATEWAY_URL = config.GATEWAY_URL;

// Non-sensitive user fields persisted to localStorage.
// accessToken is kept only in React state (in-memory) so XSS cannot steal it from storage.
type PersistedUser = Omit<User, 'accessToken'>;

export default function AuthProvider({ children }: AuthProviderProps) {
  const [persistedUser, setPersistedUser] = useLocalStorage<PersistedUser | null>('user', null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // Derive the full User object in-memory — accessToken is never written to localStorage.
  const user: User | null = persistedUser && accessToken
    ? { ...persistedUser, accessToken }
    : null;

  // setUser splits the user object: non-sensitive fields → localStorage, accessToken → state.
  const setUser = (userData: User | null) => {
    if (userData === null) {
      setPersistedUser(null);
      setAccessToken(null);
    } else {
      const { accessToken: at, ...rest } = userData;
      setPersistedUser(rest);
      setAccessToken(at);
    }
  };

  const [signedIn, setSignedIn] = useState(!!persistedUser);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingMfaToken, setPendingMfaToken] = useState<string | null>(null);
  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);
  const [turnCredentials, setTurnCredentials] = useState<{ username: string; password: string; ttl: number } | null>(null);

  useEffect(() => {
    if (accessToken) {
      fetchMfaStatus();
    }
  }, [accessToken]);

  useEffect(() => {
    if (accessToken && signedIn && !isLoading) {
      fetchTurnCredentials(accessToken);
    } else if (!signedIn) {
      setTurnCredentials(null);
    }
  }, [accessToken, signedIn, isLoading]);

  const changeUserIsMfaEnabled = (enabled: boolean) => {
    if (persistedUser) {
      setPersistedUser({ ...persistedUser, mfaEnabled: enabled });
    }
  };

  function logout() {
    setPersistedUser(null);
    setAccessToken(null);
    setSignedIn(false);
    setMfaRequired(false);
    setPendingMfaToken(null);
    setMfaStatus(null);
  }

  const fetchTurnCredentials = async (token: string) => {
    try {
      const response = await axios.get(`${GATEWAY_URL}/turn-credentials`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = response.data as { username: string; password: string; ttl: number };
      setTurnCredentials(prev =>
        prev?.username === data.username && prev?.password === data.password
          ? prev
          : data
      );
    } catch {
      console.error('Failed to fetch TURN credentials refresh');
    }
  };

  const fetchMfaStatus = async () => {
    if (!accessToken) return;
    const response = await axios.get(`${BASE_URL}/mfa/status`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (response.status === 200) {
      setMfaStatus(response.data as MfaStatus);
    }
  };

  const checkToken = async () => {
    // On page reload accessToken is null (in-memory only).
    // Use persistedUser.refreshToken to obtain a new accessToken.
    const storedRefreshToken = persistedUser?.refreshToken;

    if (!accessToken && !storedRefreshToken) {
      setSignedIn(false);
      return false;
    }

    if (accessToken) {
      try {
        const response = await axios.get(`${BASE_URL}/user/me`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const responseData = response.data as MeResponse;
        changeUserIsMfaEnabled(responseData.mfaEnabled ?? false);
        setSignedIn(true);
        return true;
      } catch {
        // Access token invalid — fall through to refresh
      }
    }

    if (storedRefreshToken) {
      try {
        const refreshResponse = await axios.post(`${BASE_URL}/user/refresh`, { token: storedRefreshToken });
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
  };

  useEffect(() => {
    checkToken().then((isValid) => {
      if (!isValid) logout();
    }).finally(() => {
      setIsLoading(false);
    });
  }, []);

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
        const payload = decodeJwt(userData.accessToken);
        userData.sub = payload?.sub as string;
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
        const payload = decodeJwt(userData.accessToken);
        userData.sub = payload?.sub as string;
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
        headers: { Authorization: `Bearer ${accessToken}` },
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
        headers: { Authorization: `Bearer ${accessToken}` },
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
        headers: { Authorization: `Bearer ${accessToken}` },
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
    updatePassword,
    isLoading,
    turnCredentials,
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}
