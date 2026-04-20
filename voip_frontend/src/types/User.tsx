export type User = {
  sub?: string;
  username: string;
  accessToken: string;
  mfaEnabled?: boolean;
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

export type DemoLimitResponse = {
  demoToken: string;
  message: string;
}

export type MeResponse = {
  username: string;
  mfaEnabled: boolean;
}
