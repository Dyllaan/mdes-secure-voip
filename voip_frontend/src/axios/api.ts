import axios, { type InternalAxiosRequestConfig } from 'axios';
import config from '@/config/config';
import type { DemoLimitResponse } from '@/types/User';

const AUTH_URL = config.AUTH_URL;
const GATEWAY_URL = config.GATEWAY_URL;
const HUB_URL = config.HUB_SERVICE_URL
const MUSICMAN_URL = config.MUSICMAN_URL;
const SIGNALING_SERVER = config.SIGNALING_SERVER;

export class ApiError extends Error {
  status: number;
  response: unknown;
  constructor(message: string, status: number, response: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.response = response;
  }
}

let _accessToken: string | null = null;
let _refreshToken: string | null = null;
let _isRefreshing = false;
let _refreshQueue: Array<(token: string | null) => void> = [];
const PUBLIC_AUTH_PATHS = new Set([
  '/user/login',
  '/user/register',
  '/user/verify-mfa',
  '/user/refresh',
]);

export const setAccessToken = (token: string | null) => { _accessToken = token; };
export const setRefreshToken = (token: string | null) => { _refreshToken = token; };

type LogoutCallback = () => void | Promise<void>;
type TokenUpdateCallback = (accessToken: string, refreshToken: string) => void;
type DemoLimitedCallback = (payload: DemoLimitResponse) => void;
type AuthRecoveryOutcome = 'recovered' | 'logged_out' | 'demo_limited';

let onLogout: LogoutCallback | null = null;
let onTokenUpdate: TokenUpdateCallback | null = null;
let onDemoLimited: DemoLimitedCallback | null = null;

export const setupInterceptors = (
  logoutCallback: LogoutCallback,
  tokenUpdateCallback: TokenUpdateCallback,
  demoLimitedCallback?: DemoLimitedCallback,
) => {
  onLogout = logoutCallback;
  onTokenUpdate = tokenUpdateCallback;
  onDemoLimited = demoLimitedCallback ?? null;
};

export const authApi = axios.create({
  baseURL: AUTH_URL,
  validateStatus: () => true,
});

export const gateway = axios.create({
  baseURL: GATEWAY_URL,
  validateStatus: () => true,
});

export const hubApi = axios.create({
  baseURL: HUB_URL,
  validateStatus: () => true,
});

export const signalingApi = axios.create({
  baseURL: SIGNALING_SERVER,
  validateStatus: () => true,
});

export const musicmanApi = axios.create({
  baseURL: MUSICMAN_URL,
  validateStatus: () => true,
});

function normalizeRequestPath(url?: string): string | null {
  if (!url) return null;

  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return url.split('?')[0] ?? null;
  }
}

function isPublicAuthPath(url?: string): boolean {
  const path = normalizeRequestPath(url);
  return path ? PUBLIC_AUTH_PATHS.has(path) : false;
}

function isSessionBootstrapPath(url?: string): boolean {
  return normalizeRequestPath(url) === '/user/me';
}

function attachAuthHeader(cfg: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
  if (isPublicAuthPath(cfg.url)) {
    return cfg;
  }

  if (_accessToken && !cfg.headers.Authorization) {
    cfg.headers.Authorization = `Bearer ${_accessToken}`;
  }
  return cfg;
}

export function parseDemoLimitResponse(response: { status: number; data?: unknown }): DemoLimitResponse | null {
  if (response.status !== 403) return null;
  const data = response.data as Partial<DemoLimitResponse> | undefined;
  if (typeof data?.demoToken !== 'string' || typeof data?.message !== 'string') {
    return null;
  }
  return {
    demoToken: data.demoToken,
    message: data.message,
  };
}

authApi.interceptors.request.use(attachAuthHeader);
gateway.interceptors.request.use(attachAuthHeader);
hubApi.interceptors.request.use(attachAuthHeader);
musicmanApi.interceptors.request.use(attachAuthHeader);
signalingApi.interceptors.request.use(attachAuthHeader);


async function attemptRefresh(): Promise<string | DemoLimitResponse | null> {
  if (!_refreshToken) return null;
  try {
    const res = await authApi.post('/user/refresh', { refreshToken: _refreshToken });
    if (res.status === 200) {
      const data = res.data as { accessToken: string; refreshToken: string };
      setAccessToken(data.accessToken);
      setRefreshToken(data.refreshToken);
      onTokenUpdate?.(data.accessToken, data.refreshToken);
      return data.accessToken;
    }
    const demoLimit = parseDemoLimitResponse(res);
    if (demoLimit) {
      return demoLimit;
    }
  } catch {
    // refresh failed
  }
  return null;
}

export async function recoverFromAuthFailure(): Promise<AuthRecoveryOutcome> {
  if (_isRefreshing) {
    return new Promise((resolve) => {
      _refreshQueue.push((token) => {
        if (token) {
          resolve('recovered');
          return;
        }
        resolve('logged_out');
      });
    });
  }

  _isRefreshing = true;
  const newToken = await attemptRefresh();
  _isRefreshing = false;

  if (newToken) {
    if (typeof newToken !== 'string') {
      onDemoLimited?.(newToken);
      _refreshQueue.forEach((cb) => cb(null));
      _refreshQueue = [];
      return 'demo_limited';
    }

    _refreshQueue.forEach((cb) => cb(newToken));
    _refreshQueue = [];
    return 'recovered';
  }

  _refreshQueue.forEach((cb) => cb(null));
  _refreshQueue = [];
  await onLogout?.();
  return 'logged_out';
}

function attachRefreshInterceptor(instance: typeof gateway) {
  instance.interceptors.response.use(async (response) => {
    const originalRequest = response.config;
    const requestUrl = originalRequest.url;
    const isPublicAuthRequest = isPublicAuthPath(requestUrl);

    if (response.status === 401) {
      const authorizationHeader = originalRequest.headers.Authorization ?? originalRequest.headers.authorization;
      const isSessionBootstrapRequest = isSessionBootstrapPath(requestUrl);

      if (
        requestUrl?.includes('/user/logout') ||
        isPublicAuthRequest
      ) {
        return response;
      }

      if (!authorizationHeader && !isSessionBootstrapRequest) {
        return response;
      }

      const recovery = await recoverFromAuthFailure();

      if (recovery === 'recovered' && _accessToken) {
        originalRequest.headers.Authorization = `Bearer ${_accessToken}`;
        return instance(originalRequest);
      }

      return response;
    }

    if (isPublicAuthRequest) {
      return response;
    }

    const demoLimit = parseDemoLimitResponse(response);
    if (demoLimit) {
      onDemoLimited?.(demoLimit);
      return response;
    }

    return response;
  });
}

attachRefreshInterceptor(authApi);
attachRefreshInterceptor(gateway);
attachRefreshInterceptor(hubApi);
attachRefreshInterceptor(musicmanApi);
attachRefreshInterceptor(signalingApi);

export const getAccessToken = () => _accessToken;
