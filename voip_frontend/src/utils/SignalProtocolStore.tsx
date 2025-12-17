import type {
  KeyPairType,
  StorageType,
} from '@privacyresearch/libsignal-protocol-typescript';
import type { SessionRecordType } from '@privacyresearch/libsignal-protocol-typescript';
import { SignalDirectory } from './SignalDirectory';

/**
 * Signal Protocol Store implementation using IndexedDB
 * Stores identity keys, pre-keys, signed pre-keys, and session data
 */
export class SignalProtocolStore implements StorageType {
  private store: SignalDirectory;
  private identityKeyPair?: KeyPairType;
  private registrationId?: number;

  constructor() {
    this.store = new SignalDirectory();
  }

  /**
   * Initialize the store with identity key pair and registration ID
   */
  async initialize(identityKeyPair: KeyPairType, registrationId: number): Promise<void> {
    this.identityKeyPair = identityKeyPair;
    this.registrationId = registrationId;
    
    // Store in IndexedDB for persistence
    await this.store.put('identityKey', identityKeyPair);
    await this.store.put('registrationId', registrationId);
    
    console.log('Signal Protocol Store initialized');
  }

  // Direction enum for trusted identity tracking
  Direction = {
    SENDING: 1,
    RECEIVING: 2,
  };

  // ========================================
  // Identity Key Management
  // ========================================

  async getIdentityKeyPair(): Promise<KeyPairType | undefined> {
    if (this.identityKeyPair) {
      return this.identityKeyPair;
    }
    
    // Try to load from IndexedDB
    const stored = await this.store.get('identityKey');
    if (stored) {
      this.identityKeyPair = stored as KeyPairType;
      return this.identityKeyPair;
    }
    
    return undefined;
  }

  async getLocalRegistrationId(): Promise<number | undefined> {
    if (this.registrationId) {
      return this.registrationId;
    }
    
    // Try to load from IndexedDB
    const stored = await this.store.get('registrationId');
    if (stored) {
      this.registrationId = stored as number;
      return this.registrationId;
    }
    
    return undefined;
  }

  async isTrustedIdentity(
    identifier: string,
    identityKey: ArrayBuffer,
    _direction: number // Prefixed with underscore to indicate intentionally unused
  ): Promise<boolean> {
    // Check if we have a stored identity key for this identifier
    const trusted = await this.store.get(`identityKey.${identifier}`);
    
    if (!trusted) {
      // First time seeing this identity - trust it
      return true;
    }

    // Compare stored key with provided key
    return this.arrayBuffersEqual(trusted as ArrayBuffer, identityKey);
  }

  async saveIdentity(identifier: string, identityKey: ArrayBuffer): Promise<boolean> {
    const existing = await this.store.get(`identityKey.${identifier}`);
    
    // Store the identity key
    await this.store.put(`identityKey.${identifier}`, identityKey);
    
    // Return true if this is a new identity (not an update)
    if (existing) {
      return !this.arrayBuffersEqual(existing as ArrayBuffer, identityKey);
    }
    
    return false;
  }

  // ========================================
  // Pre-Key Management
  // ========================================

  async loadPreKey(keyId: string | number): Promise<KeyPairType | undefined> {
    const preKey = await this.store.get(`preKey.${keyId}`);
    return preKey as KeyPairType | undefined;
  }

  async storePreKey(keyId: string | number, keyPair: KeyPairType): Promise<void> {
    await this.store.put(`preKey.${keyId}`, keyPair);
  }

  async removePreKey(keyId: string | number): Promise<void> {
    await this.store.remove(`preKey.${keyId}`);
  }

  // ========================================
  // Signed Pre-Key Management
  // ========================================

  async loadSignedPreKey(keyId: string | number): Promise<KeyPairType | undefined> {
    const signedPreKey = await this.store.get(`signedPreKey.${keyId}`);
    return signedPreKey as KeyPairType | undefined;
  }

  async storeSignedPreKey(keyId: string | number, keyPair: KeyPairType): Promise<void> {
    await this.store.put(`signedPreKey.${keyId}`, keyPair);
  }

  async removeSignedPreKey(keyId: string | number): Promise<void> {
    await this.store.remove(`signedPreKey.${keyId}`);
  }

  // ========================================
  // Session Management
  // ========================================

  async loadSession(identifier: string): Promise<SessionRecordType | undefined> {
    const session = await this.store.get(`session.${identifier}`);
    return session as SessionRecordType | undefined;
  }

  async storeSession(identifier: string, record: SessionRecordType): Promise<void> {
    await this.store.put(`session.${identifier}`, record);
  }

  async removeSession(identifier: string): Promise<void> {
    await this.store.remove(`session.${identifier}`);
  }

  async removeAllSessions(identifier: string): Promise<void> {
    // In this implementation, we only have one session per identifier
    // If you implement multiple device support, you'd need to iterate
    await this.removeSession(identifier);
  }

  // ========================================
  // Helper Methods
  // ========================================

  private arrayBuffersEqual(buf1: ArrayBuffer, buf2: ArrayBuffer): boolean {
    if (buf1.byteLength !== buf2.byteLength) {
      return false;
    }
    
    const arr1 = new Uint8Array(buf1);
    const arr2 = new Uint8Array(buf2);
    
    for (let i = 0; i < arr1.length; i++) {
      if (arr1[i] !== arr2[i]) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Clear all stored data - useful for logout or reset
   */
  async clearAll(): Promise<void> {
    await this.store.clear();
    this.identityKeyPair = undefined;
    this.registrationId = undefined;
    console.log('Signal Protocol Store cleared');
  }
}