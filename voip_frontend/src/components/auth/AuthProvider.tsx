import { useState, useEffect, useRef } from 'react';
import { toast } from "sonner";
import { useNavigate } from 'react-router-dom';
import useLocalStorage from '@/hooks/useLocalStorage';
import { authApi, gateway, parseDemoLimitResponse, setAccessToken as setModuleAccessToken, setSessionRecoveryEnabled, setupInterceptors } from '@/axios/api';
import { decodeJwt } from '@/utils/auth/jwt';
import { getDeviceFingerprint } from '@/utils/auth/deviceFingerprint';
import type { User, MfaStatus, LoginResult, MeResponse, DemoLimitResponse } from '@/types/User';
import type { AuthContextType } from '@/types/AuthContextType';
import { AuthContext } from '@/contexts/AuthContext';
import DemoExpiredDialog from './dialog/DemoExpiredDialog';

interface AuthProviderProps {
  children: React.ReactNode;
}

type PersistedUser = Omit<User, 'accessToken'>;
const DEMO_LIMITED_ERROR = 'DEMO_LIMITED';
type SessionBootstrapState = 'anonymous' | 'valid' | 'invalid';

export default function AuthProvider({ children }: AuthProviderProps) {
  const navigate = useNavigate();
  const [persistedUser, setPersistedUser] = useLocalStorage<PersistedUser | null>('user', null);
  const [accessToken, _setAccessToken] = useState<string | null>(null);
  const isLoggingOutRef = useRef(false);
  const logoutRef = useRef<() => void | Promise<void>>(() => {});

  const user: User | null = persistedUser && accessToken
    ? { ...persistedUser, accessToken }
    : null;

  const setAccessToken = (token: string | null) => {
    _setAccessToken(token);
    setModuleAccessToken(token);
  };

  const setUser = (userData: User | null) => {
    if (userData === null) {
      setPersistedUser(null);
      setAccessToken(null);
      setSessionRecoveryEnabled(false);
    } else {
      const { accessToken: at, ...rest } = userData;

      let sub = userData.sub;
      if (!sub && at) {
        const payload = decodeJwt(at);
        sub = payload?.sub as string;
      }

      setPersistedUser({ ...rest, sub });
      setAccessToken(at);
      setSessionRecoveryEnabled(true);
    }
  };

  useEffect(() => {
    setSessionRecoveryEnabled(!!persistedUser);
  }, [persistedUser]);

  const [signedIn, setSignedIn] = useState(!!persistedUser);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingMfaToken, setPendingMfaToken] = useState<string | null>(null);
  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);
  const [turnCredentials, setTurnCredentials] = useState<{ username: string; password: string; ttl: number } | null>(null);
  const [showDemoExpiredDialog, setShowDemoExpiredDialog] = useState(false);
  const [demoLimitResponse, setDemoLimitResponse] = useState<DemoLimitResponse | null>(null);
  const [isDeletingDemoAccount, setIsDeletingDemoAccount] = useState(false);
  const [demoDeleteError, setDemoDeleteError] = useState<string | null>(null);

  const clearAuthState = () => {
    setPersistedUser(null);
    setAccessToken(null);
    setSessionRecoveryEnabled(false);
    setSignedIn(false);
    setMfaRequired(false);
    setPendingMfaToken(null);
    setMfaStatus(null);
    setTurnCredentials(null);
  };

  const resetLoginFlowState = () => {
    setSignedIn(false);
    setMfaRequired(false);
    setPendingMfaToken(null);
  };

  const presentDemoLimitDialog = (payload: DemoLimitResponse) => {
    setDemoLimitResponse(payload);
    setDemoDeleteError(null);
    setShowDemoExpiredDialog(true);
    clearAuthState();
  };

  useEffect(() => {
    logoutRef.current = logout;
  });

  useEffect(() => {
    setupInterceptors(
      () => logoutRef.current(),
      (nextAccessToken) => {
        setAccessToken(nextAccessToken);
      },
      (payload) => {
        presentDemoLimitDialog(payload);
      },
    );
  }, []);

  useEffect(() => {
    if (accessToken) fetchMfaStatus();
  }, [accessToken]);

  useEffect(() => {
    if (accessToken && signedIn && !isLoading) {
      fetchTurnCredentials();
    } else if (!signedIn) {
      setTurnCredentials(null);
    }
  }, [accessToken, signedIn, isLoading]);

  const changeUserIsMfaEnabled = (enabled: boolean) => {
    if (persistedUser) {
      setPersistedUser({ ...persistedUser, mfaEnabled: enabled });
    }
  };

  const establishAuthenticatedSession = (userData: User, successToast?: string) => {
    setUser(userData);
    setSignedIn(true);
    setMfaRequired(false);
    setPendingMfaToken(null);

    if (userData.deviceToken) {
      toast.success('Device trusted for 30 days');
    }

    if (successToast) {
      toast.success(successToast);
    }
  };

  async function logout() {
    const currentAccessToken = accessToken;

    if (isLoggingOutRef.current) {
      return;
    }

    if (!currentAccessToken) {
      clearAuthState();
      return;
    }

    isLoggingOutRef.current = true;

    try {
      await authApi.post('/user/logout', undefined, {
        headers: {
          Authorization: `Bearer ${currentAccessToken}`,
        },
      });
    } catch {
    } finally {
      isLoggingOutRef.current = false;
      clearAuthState();
      navigate('/login');
    }
  }

  const closeDemoExpiredDialog = (open: boolean) => {
    setShowDemoExpiredDialog(open);
    if (!open) {
      setDemoDeleteError(null);
      navigate('/login');
    }
  };

  const deleteDemoAccount = async () => {
    if (!demoLimitResponse) return;

    setIsDeletingDemoAccount(true);
    setDemoDeleteError(null);

    try {
      const response = await authApi.delete('/user/delete', {
        headers: {
          Authorization: `Bearer ${demoLimitResponse.demoToken}`,
        },
        validateStatus: () => true,
      });

      if (response.status === 200) {
        toast.success('Demo account deleted successfully');
        clearAuthState();
        setDemoLimitResponse(null);
        setShowDemoExpiredDialog(false);
        navigate('/login');
        return;
      }

      const errorData = response.data as { cause?: string; reason?: string; message?: string };
      const errorMessage = errorData.cause || errorData.reason || errorData.message || 'Failed to delete demo account';
      setDemoDeleteError(errorMessage);
      toast.error(errorMessage);
    } catch {
      const errorMessage = 'Failed to delete demo account';
      setDemoDeleteError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsDeletingDemoAccount(false);
    }
  };

  const fetchTurnCredentials = async () => {
    try {
      const response = await gateway.get('/turn-credentials');
      const data = response.data as { username: string; password: string; ttl: number };
      setTurnCredentials(prev =>
        prev?.username === data.username && prev?.password === data.password
          ? prev
          : data
      );
    } catch {
      console.error('Failed to fetch TURN credentials');
    }
  };

  const fetchMfaStatus = async () => {
    if (!accessToken) return;
    const response = await authApi.get('/mfa/status');
    if (response.status === 200) {
      setMfaStatus(response.data as MfaStatus);
    }
  };

  const checkToken = async (): Promise<SessionBootstrapState> => {
    if (!accessToken && !persistedUser) {
      clearAuthState();
      setSignedIn(false);
      return 'anonymous';
    }

    try {
      const response = await authApi.get('/user/me');
      if (response.status === 200) {
        const responseData = response.data as MeResponse;
        changeUserIsMfaEnabled(responseData.mfaEnabled ?? false);
        setSignedIn(true);
        return 'valid';
      }
    } catch {
      toast.error('Session recovery failed. Please retry.');
    }

    setSignedIn(false);
    return 'invalid';
  };

  useEffect(() => {
    checkToken().then((sessionState) => {
      if (sessionState === 'invalid') logout();
    }).finally(() => {
      setIsLoading(false);
    });
  }, []);

  const register = async (username: string, password: string): Promise<LoginResult> => {
    try {
      const response = await authApi.post('/user/register', { username, password }, { validateStatus: () => true });
      if (response.status === 201) {
        const userData = (response.data.response ?? response.data) as User;
        establishAuthenticatedSession(userData, 'Account created successfully!');
        return { success: true };
      }
      const errorData = response.data as { cause?: string };
      toast.error(errorData.cause || 'Registration failed');
      return { success: false, error: errorData.cause };
    } catch (error) {
      console.error('Registration failed:', error);
      toast.error('An unexpected error occurred');
      return { success: false, error: 'Registration failed' };
    }
  };

  const login = async (username: string, password: string, mfaCode?: string, trustDevice?: boolean): Promise<LoginResult> => {
    try {
      const deviceFingerprint = await getDeviceFingerprint();

      const response = await authApi.post('/user/login', {
        username,
        password,
        deviceFingerprint,
        ...(mfaCode && { mfaCode }),
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
        establishAuthenticatedSession(userData);
        return { success: true };
      }

      const demoLimit = parseDemoLimitResponse(response);
      if (demoLimit) {
        presentDemoLimitDialog(demoLimit);
        setSignedIn(false);
        return { success: false, error: DEMO_LIMITED_ERROR };
      }

      const errorData = response.data as { cause?: string };
      resetLoginFlowState();
      toast.error(errorData.cause || 'Login failed');
      return { success: false, error: errorData.cause };

    } catch {
      resetLoginFlowState();
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

      const response = await authApi.post('/user/verify-mfa', {
        mfaToken: pendingMfaToken,
        code: mfaCode,
        deviceFingerprint,
        trustDevice
      }, { validateStatus: () => true });

      if (response.status === 200) {
        const userData = response.data as User;
        const payload = decodeJwt(userData.accessToken);
        userData.sub = payload?.sub as string;
        establishAuthenticatedSession(userData, 'Authentication successful!');
        return { success: true };
      }

      const demoLimit = parseDemoLimitResponse(response);
      if (demoLimit) {
        presentDemoLimitDialog(demoLimit);
        return { success: false, error: DEMO_LIMITED_ERROR };
      }

      const errorData = response.data as { cause?: string };
      setSignedIn(false);
      setMfaRequired(true);
      toast.error(errorData.cause || 'Invalid authentication code');
      return { success: false, error: errorData.cause };

    } catch (error) {
      console.error('MFA verification failed:', error);
      setSignedIn(false);
      setMfaRequired(true);
      toast.error('An unexpected error occurred');
      return { success: false, error: 'Network error' };
    }
  };

  const deleteUser = async (mfaCode?: string) => {
    try {
      const response = await authApi.delete('/user/delete', {
        data: { mfaCode },
        validateStatus: () => true
      });

      if (response.status === 401) {
        toast.info('Incorrect MFA code');
      } else if (response.status === 200) {
        toast.success('User account deleted successfully');
        logout();
      }
    } catch (error) {
      console.error('Delete error:', error);
      toast.error('An unexpected error occurred');
    }
  };

  const disableMfa = async (mfaCode: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await authApi.post('/mfa/disable', { code: mfaCode }, {
        validateStatus: () => true
      });

      if (response.status === 200) {
        toast.success('MFA disabled successfully');
        changeUserIsMfaEnabled(false);
        return { success: true };
      } else {
        const errorData = response.data as { cause?: string };
        const error = errorData.cause || 'Failed to disable MFA';
        toast.error(error);
        return { success: false, error };
      }
    } catch {
      toast.error('An unexpected error occurred');
      return { success: false, error: 'Network error' };
    }
  };

  const updatePassword = async (oldPassword: string, newPassword: string, mfaCode?: string) => {
    try {
      const response = await authApi.post('/user/update-password', {
        oldPassword,
        newPassword,
        ...(mfaCode && { mfaCode })
      }, { validateStatus: () => true });

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
    register,
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
      <DemoExpiredDialog
        open={showDemoExpiredDialog}
        onOpenChange={closeDemoExpiredDialog}
        message={demoLimitResponse?.message ?? 'Your demo session has expired. Use the demo token to delete your account.'}
        onDelete={deleteDemoAccount}
        isDeleting={isDeletingDemoAccount}
        error={demoDeleteError}
      />
    </AuthContext.Provider>
  );
}
