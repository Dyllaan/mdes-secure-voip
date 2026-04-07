export type User = {
  sub?: string;
  username: string;
  accessToken: string;
  refreshToken: string;
  mfaEnabled?: boolean;
  deviceToken?: string;
}

export type MfaStatus = {
  enabled: boolean;
  verified: boolean;
}

export type LoginResult = {
  success: boolean;
  mfaRequired?: boolean;
  error?: string;
}

export type MeResponse = {
  username: string;
  mfaEnabled: boolean;
}