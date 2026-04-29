import FingerprintJS from '@fingerprintjs/fingerprintjs';
import type { Agent } from '@fingerprintjs/fingerprintjs';

let fpPromise: Promise<Agent> | null = null;

function deriveDeviceLabel(): string {
  const ua = navigator.userAgent;
  let browser = 'Unknown';
  let os = 'Unknown';
  if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Edg/')) browser = 'Edge';
  else if (ua.includes('Chrome')) browser = 'Chrome';
  else if (ua.includes('Safari')) browser = 'Safari';
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
  else if (ua.includes('Mac')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  return `${browser}/${os}`;
}

export async function getDeviceNameHash(): Promise<string> {
  try {
    const label = deriveDeviceLabel();
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(label));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return '';
  }
}

export async function getDeviceFingerprint(): Promise<string> {
  if (typeof window !== 'undefined' && (window as any).__FINGERPRINT_OVERRIDE__) {
    return (window as any).__FINGERPRINT_OVERRIDE__;
  }

  const timeout = (ms: number) => 
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Fingerprint timeout')), ms));

  try {
    if (!fpPromise) {
      fpPromise = FingerprintJS.load();
    }

    const result = await Promise.race([
      (async () => {
        const fp = await fpPromise;
        return await fp.get();
      })(),
      timeout(1000)
    ]);

    return result.visitorId;
  } catch {
    fpPromise = null; 
    return '';
  }
}
