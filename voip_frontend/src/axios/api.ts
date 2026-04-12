import axios from 'axios';
import config from '@/config/config';

const AUTH_URL = config.AUTH_URL;
const GATEWAY_URL = config.GATEWAY_URL;

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

export const setAccessToken = (token: string | null) => {
  _accessToken = token;
};

export const authApi = axios.create({
  baseURL: `${AUTH_URL}`,
  validateStatus: () => true,
});

type LogoutCallback = () => void;

let onLogout: LogoutCallback | null = null;

export const setupInterceptors = (
  logoutCallback: LogoutCallback
) => {
  onLogout = logoutCallback;
};

export const gateway = axios.create({
  baseURL: `${GATEWAY_URL}`,
  validateStatus: () => true,
});

gateway.interceptors.request.use((config) => {
  if (_accessToken) {
    config.headers.Authorization = `Bearer ${_accessToken}`;
  }
  return config;
});

authApi.interceptors.request.use((config) => {
  if (_accessToken) {
    config.headers.Authorization = `Bearer ${_accessToken}`;
  }
  return config;
});

gateway.interceptors.response.use((response) => {
  if (response.status === 401) {
    onLogout?.();
  }
  return response;
});