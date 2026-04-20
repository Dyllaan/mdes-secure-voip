import FingerprintJS from '@fingerprintjs/fingerprintjs';
import type { Agent } from '@fingerprintjs/fingerprintjs';

let fpPromise: Promise<Agent> | null = null;

/**
 * Gets a unique device identifier. 
 * Includes a timeout and test override to prevent hanging in headless environments
 */
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

    // 1-second timeout
    const result = await Promise.race([
      (async () => {
        const fp = await fpPromise;
        return await fp.get();
      })(),
      timeout(1000)
    ]);

    return result.visitorId;
  } catch (error) {
    console.warn('Device fingerprinting failed or timed out, using fallback.', error);
    
    fpPromise = null; 
    return '';
  }
}