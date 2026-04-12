import axios from 'axios';
import config from '@/config/config';

const AUTH_URL = config.AUTH_URL


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
export const authApi = axios.create({
    baseURL: `${AUTH_URL}/auth`,
    validateStatus: () => true,
});


type RefreshCallback = (token: string) => void;
type LogoutCallback = () => void;

let onTokenRefreshed: RefreshCallback | null = null;
let onLogout: LogoutCallback | null = null;

export const setupInterceptors = (
    refreshCallback: RefreshCallback,
    logoutCallback: LogoutCallback
) => {
    onTokenRefreshed = refreshCallback;
    onLogout = logoutCallback;
};

export const gateway = axios.create({
    baseURL: `${AUTH_URL}/auth`,
    validateStatus: () => true,
});