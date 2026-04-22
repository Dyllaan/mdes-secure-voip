import FingerprintJS from '@fingerprintjs/fingerprintjs';
import type { Agent } from '@fingerprintjs/fingerprintjs';

let fpPromise: Promise<Agent> | null = null;

export async function getDeviceFingerprint(): Promise<string> {
  // 1. Check for test override escape hatch
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
