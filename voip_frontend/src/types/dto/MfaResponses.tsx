export type MfaSetupResponse = {
  secret: string;
  qrCode: string;
  backupCodes: string[];
  message: string;
}