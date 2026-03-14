import type {
  SignedPreKeyPairType,
  PreKeyPairType,
  KeyPairType,
} from '@privacyresearch/libsignal-protocol-typescript';
import {
  SignalProtocolAddress,
  SessionBuilder,
  SessionCipher,
  KeyHelper,
} from '@privacyresearch/libsignal-protocol-typescript';
import { SignalProtocolStore } from './SignalProtocolStore';
import type { Socket } from 'socket.io-client';

// Types for key bundles
export interface PreKey {
  keyId: number;
  publicKey: string;
}

export interface SignedPreKey {
  keyId: number;
  publicKey: string;
  signature: string;
}

export interface PreKeyBundle {
  userId: string;
  registrationId: number;
  identityKey: string;
  signedPreKey: SignedPreKey;
  preKey?: PreKey | null;
}

export interface EncryptedMessage {
  ciphertext: string;
  type: number; // 1 = PreKeySignalMessage, 3 = SignalMessage
  registrationId: number;
}

export interface DecryptedMessage {
  message: string;
  senderUserId: string;
  senderAlias: string;
  timestamp: string;
}

export interface RoomKey {
  roomId: string;
  key: CryptoKey;
  keyId: string;
  createdAt: number;
}

/**
 * Signal Protocol Client for End-to-End Encrypted Chat
 * Supports both 1-to-1 messages and room-based group chat
 */
export class SignalProtocolClient {
  private socket: Socket;
  private store: SignalProtocolStore;
  private sessions: Map<string, SessionCipher>;
  private isInitialized: boolean = false;
  private mode: 'ephemeral' | 'persistent' = 'ephemeral';
  
  // Room-based encryption (for group chat)
  private roomKeys: Map<string, RoomKey> = new Map();
  private currentRoomId: string | null = null;
  
  // RSA keypairs for secure room key exchange
  private rsaKeyPair: CryptoKeyPair | null = null;
  private userPublicKeys: Map<string, CryptoKey> = new Map(); // userId -> RSA public key
  
  // Pre-key management
  private nextPreKeyId: number = 1;
  private readonly PREKEY_BATCH_SIZE = 100;
  // LOW_PREKEY_THRESHOLD removed - server notifies when low

  constructor(_userId: string, socket: Socket) {
    // _userId: Prefixed with underscore - passed but not stored
    this.socket = socket;
    this.sessions = new Map();
    
    // Initialize the store (will be properly set up in initialize())
    this.store = new SignalProtocolStore();
  }

  /**
   * Initialize Signal Protocol - generate keys and register with server
   */
  async initialize(mode: 'ephemeral' | 'persistent' = 'ephemeral'): Promise<void> {
    if (this.isInitialized) {
      console.log('Signal Protocol already initialized');
      return;
    }

    try {
      console.log(`Initializing Signal Protocol in ${mode} mode...`);

      let identityKeyPair: KeyPairType;
      let registrationId: number;
      let signedPreKey: SignedPreKeyPairType;
      let preKeys: PreKeyPairType[];
      let isRestoredIdentity = false;

      if (mode === 'persistent') {
        const existingIdentity = await this.store.getIdentityKeyPair();
        const existingRegId = await this.store.getLocalRegistrationId();

        if (existingIdentity && existingRegId) {
          console.log('Restoring existing Signal identity from IndexedDB...');
          identityKeyPair = existingIdentity;
          registrationId = existingRegId;
          isRestoredIdentity = true;

          const existingSignedPreKey = await this.store.loadSignedPreKey(1);
          if (existingSignedPreKey) {
            signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);
            await this.store.storeSignedPreKey(signedPreKey.keyId, signedPreKey.keyPair);
          } else {
            signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);
            await this.store.storeSignedPreKey(signedPreKey.keyId, signedPreKey.keyPair);
          }

          preKeys = await this.generatePreKeys(this.PREKEY_BATCH_SIZE);
          for (const preKey of preKeys) {
            await this.store.storePreKey(preKey.keyId, preKey.keyPair);
          }

        } else {
          // No existing identity — first time setup for persistent mode
          console.log('No existing identity found, generating new persistent identity...');
          identityKeyPair = await KeyHelper.generateIdentityKeyPair();
          registrationId = KeyHelper.generateRegistrationId();
          await this.store.initialize(identityKeyPair, registrationId);

          signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);
          await this.store.storeSignedPreKey(signedPreKey.keyId, signedPreKey.keyPair);

          preKeys = await this.generatePreKeys(this.PREKEY_BATCH_SIZE);
          for (const preKey of preKeys) {
            await this.store.storePreKey(preKey.keyId, preKey.keyPair);
          }
        }
      } else {
        console.log('Generating fresh ephemeral identity...');
        identityKeyPair = await KeyHelper.generateIdentityKeyPair();
        registrationId = KeyHelper.generateRegistrationId();
        await this.store.initialize(identityKeyPair, registrationId);

        signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);
        await this.store.storeSignedPreKey(signedPreKey.keyId, signedPreKey.keyPair);

        preKeys = await this.generatePreKeys(this.PREKEY_BATCH_SIZE);
        for (const preKey of preKeys) {
          await this.store.storePreKey(preKey.keyId, preKey.keyPair);
        }
      }

      // RSA keypair for room key exchange — always regenerate
      // (room keys are renegotiated on join anyway)
      await this.generateRSAKeyPair();

      // Register keys with server
      // Even on restore, the server's store is in-memory and may have restarted
      await this.registerKeysWithServer(
          identityKeyPair.pubKey,
          signedPreKey,
          preKeys
      );

      // Set up socket listeners
      this.setupSocketListeners();

      this.isInitialized = true;
      this.mode = mode;

      if (isRestoredIdentity) {
        console.log('Signal Protocol initialized (restored persistent identity)');
      } else {
        console.log(`Signal Protocol initialized (new ${mode} identity)`);
      }
    } catch (error) {
      console.error('Failed to initialize Signal Protocol:', error);
      throw error;
    }
  }

  /**
   * Generate RSA keypair for secure room key exchange
   */
  private async generateRSAKeyPair(): Promise<void> {
    this.rsaKeyPair = await crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true, // extractable
      ['encrypt', 'decrypt']
    );

    // Export public key to send to server
    const publicKey = await crypto.subtle.exportKey('spki', this.rsaKeyPair.publicKey);
    const publicKeyBase64 = this.arrayBufferToBase64(publicKey);

    // Register RSA public key with server and wait for confirmation
    return new Promise((resolve, reject) => {
      this.socket.emit('register-rsa-key', { publicKey: publicKeyBase64 });
      
      this.socket.once('rsa-key-registered', () => {
        console.log('RSA keypair generated and registered');
        resolve();
      });

      setTimeout(() => reject(new Error('RSA key registration timeout')), 5000);
    });
  }

  /**
   * Generate a batch of pre-keys
   */
  private async generatePreKeys(count: number): Promise<PreKeyPairType[]> {
    const preKeys: PreKeyPairType[] = [];
    
    for (let i = 0; i < count; i++) {
      const preKey = await KeyHelper.generatePreKey(this.nextPreKeyId + i);
      preKeys.push(preKey);
    }
    
    this.nextPreKeyId += count;
    return preKeys;
  }

  /**
   * Register keys with the server
   */
  private async registerKeysWithServer(
    identityPublicKey: ArrayBuffer,
    signedPreKey: SignedPreKeyPairType,
    preKeys: PreKeyPairType[]
  ): Promise<void> {
    return new Promise(async (resolve, reject) => {
      const registrationId = await this.store.getLocalRegistrationId();
      
      if (!registrationId) {
        reject(new Error('Registration ID not available'));
        return;
      }
      
      const keyData = {
        identityKey: this.arrayBufferToBase64(identityPublicKey),
        signedPreKey: {
          keyId: signedPreKey.keyId,
          publicKey: this.arrayBufferToBase64(signedPreKey.keyPair.pubKey),
          signature: this.arrayBufferToBase64(signedPreKey.signature)
        },
        preKeys: preKeys.map(pk => ({
          keyId: pk.keyId,
          publicKey: this.arrayBufferToBase64(pk.keyPair.pubKey)
        })),
        registrationId
      };

      this.socket.emit('signal-register-keys', keyData);

      // Wait for confirmation
      this.socket.once('signal-keys-registered', ({ prekeyCount }) => {
        console.log(`Keys registered: ${prekeyCount} pre-keys`);
        resolve();
      });

      this.socket.once('signal-error', (error) => {
        console.error('Key registration failed:', error);
        reject(new Error(error.message));
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        reject(new Error('Key registration timeout'));
      }, 10000);
    });
  }

  /**
   * Set up socket listeners for Signal Protocol events
   */
  private setupSocketListeners(): void {
    // Handle low pre-key warning
    this.socket.on('signal-prekeys-low', async ({ remaining }) => {
      console.log(`️ Pre-keys running low: ${remaining} remaining`);
      await this.refreshPreKeys();
    });

    // Handle receiving other users' RSA public keys
    this.socket.on('user-rsa-key', async ({ userId, publicKey }: { userId: string; publicKey: string }) => {
      try {
        const keyData = this.base64ToArrayBuffer(publicKey);
        const cryptoKey = await crypto.subtle.importKey(
          'spki',
          keyData,
          {
            name: 'RSA-OAEP',
            hash: 'SHA-256',
          },
          true,
          ['encrypt']
        );
        this.userPublicKeys.set(userId, cryptoKey);
        console.log(` Received RSA public key for user ${userId}`);
      } catch (error) {
        console.error('Failed to import RSA public key:', error);
      }
    });

    // Handle encrypted direct messages (1-to-1)
    this.socket.on('encrypted-chat-message', async (data) => {
      await this.handleEncryptedMessage(data);
    });

    // Handle encrypted room messages (group chat)
    this.socket.on('room-chat-message', async (data) => {
      await this.handleEncryptedRoomMessage(data);
    });

    // Handle room key requests
    this.socket.on('request-room-key', async (data) => {
      await this.handleRoomKeyRequest(data);
    });

    // Handle queued messages (sent while offline)
    this.socket.on('queued-messages', async ({ messages }) => {
      console.log(` Received ${messages.length} queued messages`);
      for (const message of messages) {
        await this.handleEncryptedMessage(message);
      }
    });
  }

  /**
   * Refresh pre-keys when running low
   */
  private async refreshPreKeys(): Promise<void> {
    try {
      console.log(' Refreshing pre-keys...');
      
      const preKeys = await this.generatePreKeys(this.PREKEY_BATCH_SIZE);
      
      // Store locally (store the keyPair part)
      for (const preKey of preKeys) {
        await this.store.storePreKey(preKey.keyId, preKey.keyPair);
      }

      // Send to server
      return new Promise((resolve, reject) => {
        this.socket.emit('signal-refresh-prekeys', {
          preKeys: preKeys.map(pk => ({
            keyId: pk.keyId,
            publicKey: this.arrayBufferToBase64(pk.keyPair.pubKey)
          }))
        });

        this.socket.once('signal-prekeys-refreshed', ({ totalPrekeys }) => {
          console.log(`Pre-keys refreshed. Total: ${totalPrekeys}`);
          resolve();
        });

        this.socket.once('signal-error', (error) => {
          console.error('Pre-key refresh failed:', error);
          reject(new Error(error.message));
        });
      });
    } catch (error) {
      console.error('Failed to refresh pre-keys:', error);
    }
  }

  /**
   * Request pre-key bundle for a recipient
   */
  private async requestPreKeyBundle(recipientUserId: string): Promise<PreKeyBundle> {
    return new Promise((resolve, reject) => {
      this.socket.emit('signal-request-bundle', { recipientUserId });

      this.socket.once('signal-prekey-bundle', (bundle: PreKeyBundle) => {
        resolve(bundle);
      });

      this.socket.once('signal-error', (error) => {
        reject(new Error(error.message));
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        reject(new Error('Pre-key bundle request timeout'));
      }, 10000);
    });
  }

  /**
   * Build a session with a recipient
   */
  private async buildSession(recipientUserId: string, bundle: PreKeyBundle): Promise<SessionCipher> {
    const address = new SignalProtocolAddress(recipientUserId, 1);
    const sessionBuilder = new SessionBuilder(this.store, address);

    // Process pre-key bundle to establish session
    await sessionBuilder.processPreKey({
      registrationId: bundle.registrationId,
      identityKey: this.base64ToArrayBuffer(bundle.identityKey),
      signedPreKey: {
        keyId: bundle.signedPreKey.keyId,
        publicKey: this.base64ToArrayBuffer(bundle.signedPreKey.publicKey),
        signature: this.base64ToArrayBuffer(bundle.signedPreKey.signature)
      },
      preKey: bundle.preKey ? {
        keyId: bundle.preKey.keyId,
        publicKey: this.base64ToArrayBuffer(bundle.preKey.publicKey)
      } : undefined
    });

    const sessionCipher = new SessionCipher(this.store, address);
    this.sessions.set(recipientUserId, sessionCipher);
    
    console.log(`Session established with ${recipientUserId}`);
    return sessionCipher;
  }

  /**
   * Encrypt a message for a recipient
   */
  async encryptMessage(recipientUserId: string, message: string): Promise<EncryptedMessage> {
    if (!this.isInitialized) {
      throw new Error('Signal Protocol not initialized');
    }

    try {
      // Get or create session
      let sessionCipher = this.sessions.get(recipientUserId);

      if (!sessionCipher) {
        console.log(` No session with ${recipientUserId}, requesting pre-key bundle...`);
        const bundle = await this.requestPreKeyBundle(recipientUserId);
        sessionCipher = await this.buildSession(recipientUserId, bundle);
      }

      // Encrypt the message
      const encoder = new TextEncoder();
      const plaintext = encoder.encode(message);
      // Convert Uint8Array to ArrayBuffer
      const ciphertext = await sessionCipher.encrypt(plaintext.buffer);

      const registrationId = await this.store.getLocalRegistrationId();
      
      // ciphertext.body is the encrypted data (type varies by library version)
      const body = ciphertext.body;
      
      if (!body) {
        throw new Error('Encryption failed - no ciphertext body');
      }
      
      const bodyBase64 = typeof body === 'string' 
        ? body 
        : this.arrayBufferToBase64(body as ArrayBuffer);
      
      return {
        ciphertext: bodyBase64,
        type: ciphertext.type, // 1 = PreKeySignalMessage, 3 = SignalMessage
        registrationId: ciphertext.registrationId || registrationId || 0
      };
    } catch (error) {
      console.error(`Failed to encrypt message for ${recipientUserId}:`, error);
      throw error;
    }
  }

  /**
   * Decrypt a received encrypted message
   */
  async decryptMessage(
    senderUserId: string,
    encryptedData: EncryptedMessage
  ): Promise<string> {
    if (!this.isInitialized) {
      throw new Error('Signal Protocol not initialized');
    }

    try {
      const address = new SignalProtocolAddress(senderUserId, 1);
      const sessionCipher = new SessionCipher(this.store, address);

      let plaintext: ArrayBuffer;

      if (encryptedData.type === 1) {
        // PreKeySignalMessage - initial message to establish session
        console.log(` Decrypting PreKeySignalMessage from ${senderUserId}`);
        plaintext = await sessionCipher.decryptPreKeyWhisperMessage(
          this.base64ToArrayBuffer(encryptedData.ciphertext),
          'binary'
        );
        
        // Store session for future messages
        this.sessions.set(senderUserId, sessionCipher);
      } else if (encryptedData.type === 3) {
        // Regular SignalMessage
        console.log(` Decrypting SignalMessage from ${senderUserId}`);
        plaintext = await sessionCipher.decryptWhisperMessage(
          this.base64ToArrayBuffer(encryptedData.ciphertext),
          'binary'
        );
      } else {
        throw new Error(`Unknown message type: ${encryptedData.type}`);
      }

      return new TextDecoder().decode(plaintext);
    } catch (error) {
      console.error(`Failed to decrypt message from ${senderUserId}:`, error);
      throw error;
    }
  }

  /**
   * Handle incoming encrypted message
   */
  private async handleEncryptedMessage(data: any): Promise<void> {
    try {
      const decryptedMessage = await this.decryptMessage(data.senderUserId, {
        ciphertext: data.ciphertext,
        type: data.type,
        registrationId: data.registrationId
      });

      // Emit decrypted message event
      const decryptedData: DecryptedMessage = {
        message: decryptedMessage,
        senderUserId: data.senderUserId,
        senderAlias: data.senderAlias,
        timestamp: data.timestamp
      };

      // You can either use a callback or an event emitter here
      this.onMessageDecrypted?.(decryptedData);
    } catch (error) {
      console.error('Failed to handle encrypted message:', error);
    }
  }

  /**
   * Handle incoming encrypted room message
   */
  private async handleEncryptedRoomMessage(data: {
    senderUserId: string;
    senderAlias: string;
    ciphertext: string;
    iv: string;
    keyId: string;
    roomId: string;
    timestamp: string;
  }): Promise<void> {
    try {
      const decryptedMessage = await this.decryptRoomMessage(
        data.ciphertext,
        data.iv,
        data.keyId,
        data.roomId
      );

      const decryptedData: DecryptedMessage = {
        message: decryptedMessage,
        senderUserId: data.senderUserId,
        senderAlias: data.senderAlias,
        timestamp: data.timestamp
      };

      this.onRoomMessageDecrypted?.(decryptedData);
    } catch (error) {
      console.error('Failed to handle encrypted room message:', error);
    }
  }

  /**
   * Send encrypted message to recipient
   */
  async sendEncryptedMessage(recipientUserId: string, message: string): Promise<void> {
    try {
      const encrypted = await this.encryptMessage(recipientUserId, message);
      
      return new Promise((resolve, reject) => {
        this.socket.emit('encrypted-chat-message', {
          recipientUserId,
          ciphertext: encrypted.ciphertext,
          type: encrypted.type,
          registrationId: encrypted.registrationId
        });

        // Wait for delivery confirmation
        this.socket.once('message-delivered', ({ recipientUserId: recipient }) => {
          console.log(`Message delivered to ${recipient}`);
          resolve();
        });

        this.socket.once('message-queued', () => {
          console.log(` Message queued (recipient offline)`);
          resolve();
        });

        this.socket.once('chat-error', (error) => {
          console.error('Failed to send message:', error);
          reject(new Error(error.message));
        });

        // Timeout after 10 seconds
        setTimeout(() => {
          reject(new Error('Message send timeout'));
        }, 10000);
      });
    } catch (error) {
      console.error('Failed to send encrypted message:', error);
      throw error;
    }
  }

  /**
   * Join a room and generate/receive room encryption key
   */
  async joinRoom(roomId: string, existingUsers: string[]): Promise<void> {
    this.currentRoomId = roomId;
    
    if (existingUsers.length === 0) {
      // First user in room - generate room key
      console.log(' Creating new room key as first user');
      await this.generateRoomKey(roomId);
    } else {
      // Wait for RSA key to be available (with retries)
      const targetUserId = existingUsers[0];
      console.log(` Waiting for RSA key from user ${targetUserId}...`);
      
      let attempts = 0;
      while (!this.userPublicKeys.has(targetUserId) && attempts < 20) {
        await new Promise(resolve => setTimeout(resolve, 250));
        attempts++;
      }
      
      if (!this.userPublicKeys.has(targetUserId)) {
        throw new Error(`RSA public key not available for user ${targetUserId}`);
      }
      
      // Request room key from existing user
      console.log(' Requesting room key from existing user');
      await this.requestRoomKey(roomId, existingUsers[0]);
    }
  }

  /**
   * Generate a new symmetric key for the room
   */
  private async generateRoomKey(roomId: string): Promise<void> {
    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );

    const keyId = crypto.randomUUID();
    
    this.roomKeys.set(roomId, {
      roomId,
      key,
      keyId,
      createdAt: Date.now()
    });

    console.log(`Room key generated for ${roomId}`);
  }

  /**
   * Request room key from an existing room member
   */
  private async requestRoomKey(roomId: string, fromUserId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Request room key encrypted with our RSA public key
      this.socket.emit('request-room-key', { roomId, fromUserId });

      this.socket.once('room-key-response', async (data: {
        encryptedKey: string;
        keyId: string;
      }) => {
        try {
          if (!this.rsaKeyPair) {
            throw new Error('RSA keypair not initialized');
          }

          // Decrypt the room key using our RSA private key
          const encryptedKeyBuffer = this.base64ToArrayBuffer(data.encryptedKey);
          const decryptedKeyBuffer = await crypto.subtle.decrypt(
            { name: 'RSA-OAEP' },
            this.rsaKeyPair.privateKey,
            encryptedKeyBuffer
          );

          // Import the decrypted AES key
          const keyData = JSON.parse(new TextDecoder().decode(decryptedKeyBuffer));
          const key = await crypto.subtle.importKey(
            'jwk',
            keyData,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
          );

          this.roomKeys.set(roomId, {
            roomId,
            key,
            keyId: data.keyId,
            createdAt: Date.now()
          });

          console.log(`Room key received and decrypted for ${roomId}`);
          resolve();
        } catch (error) {
          console.error('Failed to decrypt room key:', error);
          reject(error);
        }
      });

      this.socket.once('signal-error', (error) => {
        reject(new Error(error.message));
      });

      setTimeout(() => reject(new Error('Room key request timeout')), 10000);
    });
  }

  /**
   * Handle room key request from new user
   */
  private async handleRoomKeyRequest(data: { roomId: string; requesterId: string }): Promise<void> {
    const roomKey = this.roomKeys.get(data.roomId);
    
    if (!roomKey) {
      console.error('No room key available for', data.roomId);
      return;
    }

    // Wait for requester's RSA public key (with retry)
    let requesterPublicKey = this.userPublicKeys.get(data.requesterId);
    
    if (!requesterPublicKey) {
      console.log(`⏳ Waiting for RSA public key from ${data.requesterId}...`);
      
      // Wait up to 5 seconds for the key
      let attempts = 0;
      while (!requesterPublicKey && attempts < 20) {
        await new Promise(resolve => setTimeout(resolve, 250));
        requesterPublicKey = this.userPublicKeys.get(data.requesterId);
        attempts++;
      }
      
      if (!requesterPublicKey) {
        console.error('Timeout waiting for RSA public key from', data.requesterId);
        this.socket.emit('signal-error', { 
          message: 'RSA public key not available' 
        });
        return;
      }
    }

    try {
      // Export room key as JWK
      const exportedKey = await crypto.subtle.exportKey('jwk', roomKey.key);
      const keyJson = JSON.stringify(exportedKey);

      // Encrypt room key with requester's RSA public key
      const encoder = new TextEncoder();
      const keyData = encoder.encode(keyJson);
      const encryptedKey = await crypto.subtle.encrypt(
        { name: 'RSA-OAEP' },
        requesterPublicKey,
        keyData
      );

      // Send encrypted room key
      this.socket.emit('room-key-response', {
        roomId: data.roomId,
        requesterId: data.requesterId,
        encryptedKey: this.arrayBufferToBase64(encryptedKey),
        keyId: roomKey.keyId
      });

      console.log(`Sent RSA-encrypted room key to ${data.requesterId}`);
    } catch (error) {
      console.error('Failed to send room key:', error);
    }
  }

  /**
   * Encrypt message for current room (group chat)
   */
  async encryptRoomMessage(message: string): Promise<{
    ciphertext: string;
    iv: string;
    keyId: string;
  }> {
    if (!this.currentRoomId) {
      throw new Error('Not in a room');
    }

    const roomKey = this.roomKeys.get(this.currentRoomId);
    if (!roomKey) {
      throw new Error('No room key available');
    }

    // Generate random IV
    const ivArray = crypto.getRandomValues(new Uint8Array(12));
    
    // Encrypt message with AES-GCM  
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: ivArray },
      roomKey.key,
      data
    );

    return {
      ciphertext: this.arrayBufferToBase64(encrypted),
      iv: this.uint8ArrayToBase64(ivArray),
      keyId: roomKey.keyId
    };
  }

  /**
   * Decrypt room message (group chat)
   */
  async decryptRoomMessage(
    ciphertext: string,
    iv: string,
    keyId: string,
    roomId?: string
  ): Promise<string> {
    const targetRoomId = roomId || this.currentRoomId;
    if (!targetRoomId) {
      throw new Error('No room context');
    }

    const roomKey = this.roomKeys.get(targetRoomId);
    if (!roomKey) {
      throw new Error('No room key available');
    }

    if (roomKey.keyId !== keyId) {
      throw new Error('Key ID mismatch - may need to request new room key');
    }

    // Decrypt with AES-GCM
    const encrypted = this.base64ToArrayBuffer(ciphertext);
    const ivArray = this.base64ToArrayBuffer(iv);
    
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(ivArray) },
      roomKey.key,
      encrypted
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  }

  /**
   * Send encrypted room message (broadcast to all in room)
   */
  async sendRoomMessage(message: string): Promise<void> {
    if (!this.currentRoomId) {
      throw new Error('Not in a room');
    }

    try {
      const encrypted = await this.encryptRoomMessage(message);
      
      // Send to server to broadcast to room
      this.socket.emit('room-chat-message', {
        roomId: this.currentRoomId,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        keyId: encrypted.keyId
      });

      console.log(' Encrypted room message sent');
    } catch (error) {
      console.error('Failed to send room message:', error);
      throw error;
    }
  }

  /**
   * Leave current room
   */
  leaveRoom(): void {
    if (this.currentRoomId) {
      this.roomKeys.delete(this.currentRoomId);
      this.currentRoomId = null;
      console.log(' Left room and cleared room key');
    }
  }

  /**
   * Callback for decrypted messages - override this
   */
  onMessageDecrypted?: (message: DecryptedMessage) => void;

  /**
   * Callback for decrypted room messages - override this
   */
  onRoomMessageDecrypted?: (message: DecryptedMessage) => void;

  /**
   * Check if Signal Protocol is initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Check if ready to send room messages
   */
  isRoomReady(): boolean {
    return this.isInitialized && this.currentRoomId !== null && this.roomKeys.has(this.currentRoomId);
  }

  /**
   * Cleanup - call when disconnecting
   */
  cleanup(): void {
    this.sessions.clear();
    this.roomKeys.clear();
    this.currentRoomId = null;
    this.isInitialized = false;

    if (this.mode === 'ephemeral') {
      this.store.clearAll();
    }
  }

  // Helper methods for encoding/decoding
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private uint8ArrayToBase64(array: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < array.byteLength; i++) {
      binary += String.fromCharCode(array[i]);
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}