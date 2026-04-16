import axios, { type InternalAxiosRequestConfig } from 'axios';
import config from '@/config/config';

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

export const setAccessToken = (token: string | null) => { _accessToken = token; };
export const setRefreshToken = (token: string | null) => { _refreshToken = token; };

type LogoutCallback = () => void;
type TokenUpdateCallback = (accessToken: string, refreshToken: string) => void;

let onLogout: LogoutCallback | null = null;
let onTokenUpdate: TokenUpdateCallback | null = null;

export const setupInterceptors = (
  logoutCallback: LogoutCallback,
  tokenUpdateCallback: TokenUpdateCallback,
) => {
  onLogout = logoutCallback;
  onTokenUpdate = tokenUpdateCallback;
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

function attachAuthHeader(cfg: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
  if (_accessToken) {
    cfg.headers.Authorization = `Bearer ${_accessToken}`;
  }
  return cfg;
}

authApi.interceptors.request.use(attachAuthHeader);
gateway.interceptors.request.use(attachAuthHeader);
hubApi.interceptors.request.use(attachAuthHeader);
musicmanApi.interceptors.request.use(attachAuthHeader);
signalingApi.interceptors.request.use(attachAuthHeader);


async function attemptRefresh(): Promise<string | null> {
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
  } catch {
    // refresh failed
  }
  return null;
}

function attachRefreshInterceptor(instance: typeof gateway) {
  instance.interceptors.response.use(async (response) => {
    if (response.status === 401) {
      const originalRequest = response.config;

      if (originalRequest.url?.includes('/user/logout')) {
        return response;
      }

      if (_isRefreshing) {
        return new Promise((resolve) => {
          _refreshQueue.push((token) => {
            if (token) originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(instance(originalRequest));
          });
        });
      }

      _isRefreshing = true;
      const newToken = await attemptRefresh();
      _isRefreshing = false;

      if (newToken) {
        _refreshQueue.forEach((cb) => cb(newToken));
        _refreshQueue = [];
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return instance(originalRequest);
      }

      _refreshQueue.forEach((cb) => cb(null));
      _refreshQueue = [];
      onLogout?.();
      return response;
    }

    if (response.status === 403 && (response.data as any)?.code === 'DEMO_EXPIRED') {
      onLogout?.();
      return response;
    }

    return response;
  });
}

attachRefreshInterceptor(authApi);
attachRefreshInterceptor(gateway);
attachRefreshInterceptor(authApi);
attachRefreshInterceptor(gateway);

export const getAccessToken = () => _accessToken;
