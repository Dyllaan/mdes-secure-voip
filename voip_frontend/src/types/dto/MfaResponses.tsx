export type MfaSetupResponse = {
  secret: string;
  qrCode: string;
  backupCodes: string[];
  message: string;
}

export type MfaStatus = {
  enabled: boolean;
  verified: boolean;
}
