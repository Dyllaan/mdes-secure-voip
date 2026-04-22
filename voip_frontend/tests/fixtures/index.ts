import { expect, type Page } from '@playwright/test';

export const MOCK_USER = {
  id: 'test-user-id',
  sub: 'test-user-id',
  username: 'testuser',
  accessToken: 'fake-access-token',
  mfaEnabled: false,
};

export const MOCK_HUBS = [
  { id: 'hub-1', name: 'Test Hub One', createdAt: '2024-01-01T00:00:00.000Z', ownerId: 'test-user-id' },
  { id: 'hub-2', name: 'Test Hub Two', createdAt: '2024-02-01T00:00:00.000Z', ownerId: 'test-user-id' },
];

export const MOCK_MFA_USER = {
  ...MOCK_USER,
  mfaEnabled: true,
};

export const MOCK_CHANNELS = {
  'hub-1': [
    { id: 'channel-1', name: 'general', type: 'text', hubId: 'hub-1', createdAt: '2024-01-01T00:00:00.000Z', position: 0 },
    { id: 'channel-2', name: 'voice-lobby', type: 'voice', hubId: 'hub-1', createdAt: '2024-01-01T00:10:00.000Z', position: 1 },
  ],
  'hub-2': [
    { id: 'channel-3', name: 'announcements', type: 'text', hubId: 'hub-2', createdAt: '2024-02-01T00:00:00.000Z', position: 0 },
  ],
} as const;

export const MOCK_MEMBERS = {
  'hub-1': [
    { id: 'member-1', userId: 'test-user-id', hubId: 'hub-1', username: 'testuser', alias: 'testuser', role: 'owner', joinedAt: '2024-01-01T00:00:00.000Z' },
    { id: 'member-2', userId: 'member-2', hubId: 'hub-1', username: 'teammate', alias: 'teammate', role: 'member', joinedAt: '2024-01-01T00:05:00.000Z' },
  ],
  'hub-2': [
    { id: 'member-3', userId: 'test-user-id', hubId: 'hub-2', username: 'testuser', alias: 'testuser', role: 'owner', joinedAt: '2024-02-01T00:00:00.000Z' },
  ],
} as const;

export const MOCK_MFA_SETUP = {
  secret: 'JBSWY3DPEHPK3PXP',
  qrCode: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9s2m30UAAAAASUVORK5CYII=',
  backupCodes: ['12345678', '23456789', '34567890', '45678901'],
  message: 'MFA setup initiated',
};

export const MOCK_ENCRYPTED_MESSAGE = {
  id: 'message-1',
  channelId: 'channel-1',
  senderId: 'member-2',
  ciphertext: 'ZmFrZQ==',
  iv: 'ZmFrZWl2',
  keyVersion: '999',
  timestamp: '2024-01-01T09:00:00.000Z',
};

export const DEMO_LIMIT_RESPONSE = {
  demoToken: 'demo-delete-token',
  message: 'Your demo session has expired. Use the demo token to delete your account.',
};

export function authRecoveryOptions(
  outcome: 'success' | 'unauthorized' | 'demo-limited',
  user = MOCK_USER,
) {
  if (outcome === 'success') {
    return {
      refreshStatus: 200,
      refreshBody: user,
    };
  }

  if (outcome === 'demo-limited') {
    return {
      refreshStatus: 403,
      refreshBody: DEMO_LIMIT_RESPONSE,
    };
  }

  return {
    refreshStatus: 401,
    refreshBody: { cause: 'Refresh failed' },
  };
}

// CORS headers added to every mocked cross-origin (localhost:8080) response
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'http://localhost:5173',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function enableAppE2EHarness(page: Page) {
  await page.addInitScript(() => {
    (window as any).__FINGERPRINT_OVERRIDE__ = 'e2e-test-device';
    const createMediaStream = ({ audio = false, video = false }: { audio?: boolean; video?: boolean } = {}) => {
      const tracks: MediaStreamTrack[] = [];

      if (video) {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 18;
        const ctx = canvas.getContext('2d');
        ctx?.fillRect(0, 0, canvas.width, canvas.height);
        const canvasStream = canvas.captureStream(1);
        const [videoTrack] = canvasStream.getVideoTracks();
        if (videoTrack) tracks.push(videoTrack);
      }

      if (audio) {
        const AudioCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioCtor) {
          const audioContext = new AudioCtor();
          const destination = audioContext.createMediaStreamDestination();
          const oscillator = audioContext.createOscillator();
          const gain = audioContext.createGain();
          gain.gain.value = 0;
          oscillator.connect(gain);
          gain.connect(destination);
          oscillator.start();
          destination.stream.getAudioTracks().forEach((track) => tracks.push(track));
        }
      }

      return new MediaStream(tracks);
    };

    const listenersFor = (socket: {
      listeners?: (event: string) => Array<(...args: unknown[]) => void>;
      _callbacks?: Record<string, Array<(...args: unknown[]) => void>>;
    }, event: string) => {
      if (typeof socket.listeners === 'function') {
        return socket.listeners(event) ?? [];
      }
      return socket._callbacks?.[`$${event}`] ?? [];
    };

    const state = {
      socket: null as null | {
        emit: (event: string, ...args: unknown[]) => unknown;
        listeners?: (event: string) => Array<(...args: unknown[]) => void>;
        _callbacks?: Record<string, Array<(...args: unknown[]) => void>>;
      },
      sentSocketEvents: [] as Array<{ event: string; payload: unknown }>,
      audioControllers: new Set<{ addRemoteStream: (peerId: string, alias?: string) => void; removeRemoteStream: (peerId: string) => void }>(),
      screenshareControllers: new Set<{ addRemoteStream: (peerId: string, alias?: string) => void; removeRemoteStream: (peerId: string) => void }>(),
      screenPeerCounter: 0,
    };

    window.__APP_E2E__ = {
      enabled: true,
      registerSocket(socket) {
        state.socket = socket;
        const originalEmit = socket.emit.bind(socket);
        socket.emit = (event: string, ...args: unknown[]) => {
          state.sentSocketEvents.push({ event, payload: args[0] });

          if (event === 'register-rsa-key') {
            setTimeout(() => {
              window.__APP_E2E__?.emitSocketEvent('rsa-key-registered');
            }, 0);
          }

          if (event === 'request-screen-peer-id') {
            state.screenPeerCounter += 1;
            setTimeout(() => {
              window.__APP_E2E__?.emitSocketEvent('screen-peer-assigned', {
                peerId: `screen-peer-${state.screenPeerCounter}`,
              });
            }, 0);
          }

          if (event === 'join-room') {
            setTimeout(() => {
              window.__APP_E2E__?.emitSocketEvent('all-users', []);
            }, 0);
          }

          return originalEmit(event, ...args);
        };
      },
      emitSocketEvent(event: string, payload?: unknown) {
        if (!state.socket) return;
        for (const listener of listenersFor(state.socket, event)) {
          try {
            listener(payload);
          } catch (error) {
            console.error('[APP_E2E] socket listener failed', event, error);
          }
        }
      },
      getSentSocketEvents() {
        return [...state.sentSocketEvents];
      },
      registerAudioController(controller) {
        state.audioControllers.add(controller);
        return () => state.audioControllers.delete(controller);
      },
      registerScreenshareController(controller) {
        state.screenshareControllers.add(controller);
        return () => state.screenshareControllers.delete(controller);
      },
      addRemoteAudioStream(peerId: string, alias?: string) {
        state.audioControllers.forEach((controller) => controller.addRemoteStream(peerId, alias));
      },
      removeRemoteAudioStream(peerId: string) {
        state.audioControllers.forEach((controller) => controller.removeRemoteStream(peerId));
      },
      addRemoteScreenshare(peerId: string, alias?: string) {
        state.screenshareControllers.forEach((controller) => controller.addRemoteStream(peerId, alias));
      },
      removeRemoteScreenshare(peerId: string) {
        state.screenshareControllers.forEach((controller) => controller.removeRemoteStream(peerId));
      },
      createMediaStream,
    };

    const mediaDevices = navigator.mediaDevices ?? ({} as MediaDevices);
    const getUserMedia = async () => createMediaStream({ audio: true });
    const getDisplayMedia = async () => createMediaStream({ audio: true, video: true });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        ...mediaDevices,
        getUserMedia,
        getDisplayMedia,
      },
    });
  });
}

export async function connectAppSocket(page: Page, peerId = 'peer-self') {
  await page.waitForFunction(() => !!window.__APP_E2E__?.enabled && !!window.__APP_E2E__?.getSentSocketEvents);
  await page.waitForFunction(() => {
    const harness = window.__APP_E2E__;
    return !!harness && 'enabled' in harness;
  });
  await page.waitForFunction(() => {
    const harness = window.__APP_E2E__ as { enabled?: boolean; emitSocketEvent?: (event: string, payload?: unknown) => void; getSentSocketEvents?: () => unknown[] } | undefined;
    return !!harness?.enabled;
  });
  await page.waitForFunction(() => {
    const harness = window.__APP_E2E__ as { enabled?: boolean; emitSocketEvent?: (event: string, payload?: unknown) => void; getSentSocketEvents?: () => unknown[]; registerSocket?: unknown } | undefined;
    return !!harness && typeof harness.emitSocketEvent === 'function';
  });
  await page.waitForFunction(() => {
    const harness = window.__APP_E2E__ as { enabled?: boolean; emitSocketEvent?: (event: string, payload?: unknown) => void; getSentSocketEvents?: () => unknown[]; registerSocket?: unknown; socket?: unknown } | undefined;
    return !!harness;
  });
  await page.waitForFunction(() => {
    return !!(window as typeof window & { __APP_E2E__?: { enabled: boolean; getSentSocketEvents: () => unknown[] } }).__APP_E2E__;
  });
  await page.waitForTimeout(50);
  await page.evaluate((id) => {
    window.__APP_E2E__?.emitSocketEvent('peer-assigned', { peerId: id });
    window.__APP_E2E__?.emitSocketEvent('connect');
  }, peerId);
  try {
    await page.waitForFunction(() => {
      const events = window.__APP_E2E__?.getSentSocketEvents?.() ?? [];
      return events.some((entry) => (entry as { event?: string }).event === 'register-rsa-key');
    }, { timeout: 2000 });
  } catch {
    // Some flows reconnect after the initial RoomClient bootstrap and don't
    // need to block on RSA registration again.
  }
}

export async function emitSocketEvent(page: Page, event: string, payload?: unknown) {
  await page.evaluate(([name, data]) => {
    window.__APP_E2E__?.emitSocketEvent(name, data);
  }, [event, payload] as const);
}

export async function emitSocketAuthFailure(page: Page, message: 'Invalid or expired token' | 'Authentication required') {
  await emitSocketEvent(page, 'connect_error', { message });
}

export async function emitSocketSessionExpired(page: Page) {
  await emitSocketEvent(page, 'session-expired', { message: 'Session expired, please log in again' });
}

export async function addRemoteAudioPeer(page: Page, peerId: string, alias: string) {
  await page.evaluate(([id, label]) => {
    window.__APP_E2E__?.addRemoteAudioStream(id, label);
  }, [peerId, alias] as const);
}

export async function removeRemoteAudioPeer(page: Page, peerId: string) {
  await page.evaluate((id) => {
    window.__APP_E2E__?.removeRemoteAudioStream(id);
  }, peerId);
}

export async function addRemoteScreenshare(page: Page, peerId: string, alias: string) {
  await page.evaluate(([id, label]) => {
    window.__APP_E2E__?.addRemoteScreenshare(id, label);
  }, [peerId, alias] as const);
}

export async function removeRemoteScreenshare(page: Page, peerId: string) {
  await page.evaluate((id) => {
    window.__APP_E2E__?.removeRemoteScreenshare(id);
  }, peerId);
}

// Auth state helpers

/**
 * Writes MOCK_USER into localStorage via page.evaluate().
 * Call after page has navigated to the app origin.
 */
export async function injectAuthState(page: Page, user = MOCK_USER) {
  await page.evaluate((u) => {
    localStorage.setItem('user', JSON.stringify(u));
  }, user);
}

/**
 * Adds an initScript that writes auth state into localStorage before each
 * navigation. Use this when you need auth state available from the very first
 * page render (e.g. PublicRoute redirect tests).
 */
export async function setAuthState(page: Page, user = MOCK_USER) {
  await page.addInitScript((u) => {
    localStorage.setItem('user', JSON.stringify(u));
  }, user);
}

// IndexedDB setup - satisfies KeysRequired guard

/**
 * Writes a real ECDH keypair into the 'channel-keys-v1' IndexedDB so that
 * KeysRequired sees keys exist and renders children instead of redirecting
 * to /keys.
 *
 * IMPORTANT: The page must already be on the app origin (http://localhost:5173)
 * before calling this, since IDB is origin-scoped. Call after an initial
 * page.goto('/login') to establish the origin.
 */
export async function setupIDB(page: Page, userId = MOCK_USER.sub) {
  await page.evaluate(async (idbUserId) => {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveKey', 'deriveBits'],
    );

    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(`channel-keys-v1-${idbUserId}`, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        if (!db.objectStoreNames.contains('channelKeys')) db.createObjectStore('channelKeys');
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('meta', 'readwrite');
        tx.objectStore('meta').put(keyPair, 'ecdhKeyPair');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(new Error('IDB write failed'));
      };
      req.onerror = () => reject(new Error('IDB open failed'));
    });
  }, userId);
}

export async function clearIDB(page: Page, userId = MOCK_USER.sub) {
  await page.evaluate(async (idbUserId) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(`channel-keys-v1-${idbUserId}`);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error('IDB delete failed'));
      req.onblocked = () => resolve();
    });
  }, userId);
}

export async function bootstrapSignedOut(page: Page) {
  await enableAppE2EHarness(page);
  await mockAuthRoutes(page, undefined, { meStatus: 401, refreshStatus: 401 });
}

export async function bootstrapSignedIn(page: Page, user = MOCK_USER) {
  await enableAppE2EHarness(page);
  await mockAuthRoutes(page, user, { meStatus: 200, refreshStatus: 401, mfaEnabled: user.mfaEnabled ?? false });
  await mockSocketIO(page);
  await mockWebSocket(page);
  await page.route('**/auth/user/login', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(user),
    }),
  );
  await page.goto('/#/login');
  await clearIDB(page, user.sub);
  await page.getByTestId('username-input').fill(user.username);
  await page.getByTestId('password-input').fill('password123');
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/#\/keys$/, { timeout: 5000 });
}

export async function bootstrapSignedInWithKeys(page: Page, user = MOCK_USER) {
  await enableAppE2EHarness(page);
  await mockAuthRoutes(page, user, { meStatus: 200, refreshStatus: 401, mfaEnabled: user.mfaEnabled ?? false });
  await mockSocketIO(page);
  await mockWebSocket(page);
  await page.route('**/auth/user/login', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(user),
    }),
  );
  await page.goto('/#/login');
  await clearIDB(page, user.sub);
  await setupIDB(page, user.sub);
  await page.getByTestId('username-input').fill(user.username);
  await page.getByTestId('password-input').fill('password123');
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/#\/hub-list$/, { timeout: 5000 });
}

export async function bootstrapProfilePage(page: Page, user = MOCK_USER) {
  await bootstrapSignedInWithKeys(page, user);
  await page.goto('/#/profile');
}
// Network route mocks

/**
 * Mocks the auth service endpoints that AuthProvider calls on every page load:
 *   GET /auth/user/me       -> 200 (token is valid)
 *   POST /auth/user/refresh -> 200 (refresh succeeds)
 *   GET /auth/mfa/status    -> 200 { enabled: false, verified: true }
 */
export async function mockAuthRoutes(
  page: Page,
  user = MOCK_USER,
  options: {
    meStatus?: number;
    meStatuses?: number[];
    refreshStatus?: number;
    refreshBody?: Record<string, unknown>;
    mfaEnabled?: boolean;
    mfaVerified?: boolean;
    includeTurnCredentials?: boolean;
    deleteStatus?: number;
    deleteBody?: Record<string, unknown>;
    logoutStatus?: number;
    logoutBody?: Record<string, unknown>;
  } = {},
) {
  const {
    meStatus = 200,
    meStatuses,
    refreshStatus = 200,
    refreshBody,
    mfaEnabled = false,
    mfaVerified = true,
    includeTurnCredentials = true,
    deleteStatus = 200,
    deleteBody = { message: 'User deleted successfully' },
    logoutStatus = 200,
    logoutBody = { message: 'Logged out successfully' },
  } = options;
  const queuedMeStatuses = [...(meStatuses ?? [meStatus])];

  await page.route('**/auth/user/me', (route) => {
    const nextStatus = queuedMeStatuses.length > 1 ? queuedMeStatuses.shift() ?? meStatus : queuedMeStatuses[0] ?? meStatus;
    return route.fulfill({
      status: nextStatus,
      contentType: 'application/json',
      body: JSON.stringify(
        nextStatus === 200
          ? { id: user.id, username: user.username, mfaEnabled }
          : { cause: 'Unauthorized' },
      ),
    });
  });

  await page.route('**/auth/user/refresh', (route) =>
    route.fulfill({
      status: refreshStatus,
      contentType: 'application/json',
      body: JSON.stringify(refreshStatus === 200 ? user : (refreshBody ?? { cause: 'Refresh failed' })),
    }),
  );

  await page.route('**/auth/user/delete', (route) =>
    route.fulfill({
      status: deleteStatus,
      contentType: 'application/json',
      body: JSON.stringify(deleteBody),
    }),
  );

  await page.route('**/auth/user/logout', (route) =>
    route.fulfill({
      status: logoutStatus,
      contentType: 'application/json',
      body: JSON.stringify(logoutBody),
    }),
  );

  await page.route('**/auth/mfa/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ enabled: mfaEnabled, verified: mfaVerified }),
    }),
  );

  if (includeTurnCredentials) {
    await page.route('**/turn-credentials', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ username: 'turn-user', password: 'turn-pass', ttl: 3600 }),
      }),
    );
  }
}

export async function mockProfileRoutes(
  page: Page,
  options: {
    mfaSetupSuccess?: boolean;
    mfaVerifySuccess?: boolean;
    disableMfaSuccess?: boolean;
    updatePasswordResponse?: { status: number; body: Record<string, unknown> };
    deleteUserResponse?: { status: number; body?: Record<string, unknown> };
    logoutStatus?: number;
  } = {},
) {
  const {
    mfaSetupSuccess = true,
    mfaVerifySuccess = true,
    disableMfaSuccess = true,
    updatePasswordResponse = { status: 200, body: {} },
    deleteUserResponse = { status: 200, body: {} },
    logoutStatus = 200,
  } = options;

  await page.route('**/auth/mfa/setup', (route) =>
    route.fulfill({
      status: mfaSetupSuccess ? 200 : 400,
      contentType: 'application/json',
      body: JSON.stringify(mfaSetupSuccess ? MOCK_MFA_SETUP : { cause: 'Unable to set up MFA' }),
    }),
  );

  await page.route('**/auth/mfa/verify', (route) =>
    route.fulfill({
      status: mfaVerifySuccess ? 200 : 401,
      contentType: 'application/json',
      body: JSON.stringify(mfaVerifySuccess ? { success: true } : { cause: 'Invalid verification code' }),
    }),
  );

  await page.route('**/auth/mfa/disable', (route) =>
    route.fulfill({
      status: disableMfaSuccess ? 200 : 400,
      contentType: 'application/json',
      body: JSON.stringify(disableMfaSuccess ? { success: true } : { cause: 'Invalid authentication code' }),
    }),
  );

  await page.route('**/auth/user/update-password', (route) =>
    route.fulfill({
      status: updatePasswordResponse.status,
      contentType: 'application/json',
      body: JSON.stringify(updatePasswordResponse.body),
    }),
  );

  await page.route('**/auth/user/delete', (route) =>
    route.fulfill({
      status: deleteUserResponse.status,
      contentType: 'application/json',
      body: JSON.stringify(deleteUserResponse.body ?? {}),
    }),
  );

  await page.route('**/auth/user/logout', (route) =>
    route.fulfill({
      status: logoutStatus,
      contentType: 'application/json',
      body: JSON.stringify({ success: logoutStatus === 200 }),
    }),
  );
}

export async function mockMusicRoutes(
  page: Page,
  options: {
    activeRooms?: string[];
    statusByRoom?: Record<string, {
      roomId?: string;
      queue?: Array<{ id: string; url: string; title: string; channel: string; duration: string; durationMs: number; source?: 'youtube' | 'spotify' | 'soundcloud' }>;
      currentIndex?: number;
      currentTrack?: { id: string; url: string; title: string; channel: string; duration: string; durationMs: number; source?: 'youtube' | 'spotify' | 'soundcloud' } | null;
      playing: boolean;
      paused: boolean;
      positionMs: number;
      url: string | null;
      videoMode?: boolean;
      screenPeerId?: string | null;
    } | null>;
    resolveItems?: Array<{ id: string; url: string; title: string; channel: string; duration: string; durationMs: number }>;
    sharedState?: {
      activeRooms: Set<string>;
      statusByRoom: Record<string, {
        roomId?: string;
        queue?: Array<{ id: string; url: string; title: string; channel: string; duration: string; durationMs: number; source?: 'youtube' | 'spotify' | 'soundcloud' }>;
        currentIndex?: number;
        currentTrack?: { id: string; url: string; title: string; channel: string; duration: string; durationMs: number; source?: 'youtube' | 'spotify' | 'soundcloud' } | null;
        playing: boolean;
        paused: boolean;
        positionMs: number;
        url: string | null;
        videoMode?: boolean;
        screenPeerId?: string | null;
      } | null>;
    };
  } = {},
) {
  const seekRequests: Array<{ roomId: string; requestedSeconds: number; appliedSeconds: number }> = [];
  const activeRooms = options.sharedState?.activeRooms ?? new Set(options.activeRooms ?? []);
  const statusByRoom = options.sharedState?.statusByRoom ?? { ...(options.statusByRoom ?? {}) };
  const resolveItems = options.resolveItems ?? [
    {
      id: 'yt-track-1',
      url: 'https://www.youtube.com/watch?v=yt-track-1',
      title: 'Test Track',
      channel: 'Test Channel',
      duration: '3:15',
      durationMs: 195000,
    },
  ];

  await page.route(/localhost:\d+\/musicman\//, async (route) => {
    const method = route.request().method();
    const url = new URL(route.request().url());
    const pathname = url.pathname;

    if (method === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: CORS_HEADERS });
    }

    const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    const normalizeSession = (roomId: string) => {
      const session = statusByRoom[roomId];
      if (!session) return null;
      const queue = session.queue ?? (session.url ? [{
        id: `item-${roomId}`,
        url: session.url,
        title: 'Test Track',
        channel: 'Test Channel',
        duration: '3:15',
        durationMs: 195000,
      }] : []);
      const currentIndex = session.currentIndex ?? 0;
      return {
        roomId,
        queue,
        currentIndex,
        currentTrack: session.currentTrack ?? queue[currentIndex] ?? null,
        playing: session.playing,
        paused: session.paused,
        positionMs: session.positionMs,
        url: session.url,
        videoMode: session.videoMode ?? false,
        screenPeerId: session.screenPeerId ?? null,
      };
    };

    const clampSeekSeconds = (
      session: ReturnType<typeof normalizeSession>,
      seconds: number,
    ) => {
      if (!session || !Number.isFinite(seconds)) return 0;
      const durationMs = session.currentTrack?.durationMs ?? 0;
      if (durationMs <= 0) return 0;
      return Math.min(Math.max(0, Math.floor(seconds)), Math.floor(durationMs / 1000));
    };

    const fulfillSession = (roomId: string) => {
      const session = normalizeSession(roomId);
      if (session) {
        activeRooms.add(roomId);
      } else {
        activeRooms.delete(roomId);
      }
      statusByRoom[roomId] = session;
      return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ ok: true, roomId, session }) });
    };

    if (method === 'POST' && pathname.endsWith('/musicman/hub/join')) {
      return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ success: true }) });
    }

    if (method === 'GET' && pathname.endsWith('/musicman/rooms')) {
      return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ rooms: [...activeRooms] }) });
    }

    if (method === 'POST' && pathname.endsWith('/musicman/resolve')) {
      return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ items: resolveItems }) });
    }

    if (method === 'POST' && pathname.endsWith('/musicman/play')) {
      const body = JSON.parse(route.request().postData() ?? '{}') as { roomId: string; url: string; videoMode?: boolean };
      statusByRoom[body.roomId] = {
        roomId: body.roomId,
        queue: [{
          id: `item-${body.roomId}`,
          url: body.url,
          title: 'Test Track',
          channel: 'Test Channel',
          duration: '3:15',
          durationMs: 195000,
        }],
        currentIndex: 0,
        playing: true,
        paused: false,
        positionMs: 0,
        url: body.url,
        videoMode: body.videoMode ?? false,
        screenPeerId: body.videoMode ? 'music-screen-peer' : null,
      };
      return fulfillSession(body.roomId);
    }

    if (method === 'POST' && pathname.endsWith('/musicman/queue/add')) {
      const body = JSON.parse(route.request().postData() ?? '{}') as { roomId: string; items: Array<{ id: string; url: string; title: string; channel: string; duration: string; durationMs: number }>; videoMode?: boolean };
      const existing = normalizeSession(body.roomId);
      const queue = existing ? [...existing.queue, ...body.items] : [...body.items];
      statusByRoom[body.roomId] = {
        roomId: body.roomId,
        queue,
        currentIndex: existing?.currentIndex ?? 0,
        playing: true,
        paused: false,
        positionMs: existing?.positionMs ?? 0,
        url: (existing?.currentTrack ?? queue[0])?.url ?? null,
        videoMode: existing?.videoMode ?? body.videoMode ?? false,
        screenPeerId: (existing?.videoMode ?? body.videoMode) ? 'music-screen-peer' : null,
      };
      return fulfillSession(body.roomId);
    }

    if (method === 'POST' && pathname.endsWith('/musicman/queue/play')) {
      const body = JSON.parse(route.request().postData() ?? '{}') as { roomId: string; itemId: string };
      const existing = normalizeSession(body.roomId);
      if (!existing) return route.fulfill({ status: 404, headers: CORS, body: JSON.stringify({ error: 'No bot in room' }) });
      const currentIndex = existing.queue.findIndex((item) => item.id === body.itemId);
      statusByRoom[body.roomId] = {
        ...existing,
        currentIndex: currentIndex >= 0 ? currentIndex : existing.currentIndex,
        currentTrack: currentIndex >= 0 ? existing.queue[currentIndex] : existing.currentTrack,
        url: currentIndex >= 0 ? existing.queue[currentIndex].url : existing.url,
        paused: false,
        playing: true,
      };
      return fulfillSession(body.roomId);
    }

    if (method === 'POST' && pathname.endsWith('/musicman/queue/remove')) {
      const body = JSON.parse(route.request().postData() ?? '{}') as { roomId: string; itemId: string };
      const existing = normalizeSession(body.roomId);
      if (!existing) return route.fulfill({ status: 404, headers: CORS, body: JSON.stringify({ error: 'No bot in room' }) });
      const removeIndex = existing.queue.findIndex((item) => item.id === body.itemId);
      if (removeIndex === -1) return route.fulfill({ status: 404, headers: CORS, body: JSON.stringify({ error: 'Queue item not found' }) });
      const queue = existing.queue.filter((item) => item.id !== body.itemId);
      if (queue.length === 0) {
        activeRooms.delete(body.roomId);
        statusByRoom[body.roomId] = null;
        return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ ok: true, roomId: body.roomId, session: null }) });
      }
      const currentIndex = removeIndex === existing.currentIndex ? 0 : (removeIndex < existing.currentIndex ? existing.currentIndex - 1 : existing.currentIndex);
      statusByRoom[body.roomId] = {
        ...existing,
        queue,
        currentIndex,
        currentTrack: queue[currentIndex] ?? null,
        url: queue[currentIndex]?.url ?? null,
        paused: false,
        playing: true,
      };
      return fulfillSession(body.roomId);
    }

    if (method === 'POST' && pathname.endsWith('/musicman/queue/clear')) {
      const body = JSON.parse(route.request().postData() ?? '{}') as { roomId: string };
      activeRooms.delete(body.roomId);
      statusByRoom[body.roomId] = null;
      return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ ok: true, roomId: body.roomId }) });
    }

    if (method === 'POST' && pathname.endsWith('/musicman/queue/reorder')) {
      const body = JSON.parse(route.request().postData() ?? '{}') as { roomId: string; itemIds: string[] };
      const existing = normalizeSession(body.roomId);
      if (!existing) return route.fulfill({ status: 404, headers: CORS, body: JSON.stringify({ error: 'No bot in room' }) });
      const byId = new Map(existing.queue.map((item) => [item.id, item]));
      const queue = body.itemIds.map((itemId) => byId.get(itemId)).filter(Boolean);
      const currentId = existing.currentTrack?.id ?? null;
      const currentIndex = currentId ? queue.findIndex((item) => item?.id === currentId) : 0;
      statusByRoom[body.roomId] = {
        ...existing,
        queue: queue as typeof existing.queue,
        currentIndex: currentIndex >= 0 ? currentIndex : 0,
        currentTrack: queue[(currentIndex >= 0 ? currentIndex : 0)] ?? null,
      };
      return fulfillSession(body.roomId);
    }

    if (method === 'POST' && pathname.endsWith('/musicman/queue/shuffle')) {
      const body = JSON.parse(route.request().postData() ?? '{}') as { roomId: string };
      const existing = normalizeSession(body.roomId);
      if (!existing) return route.fulfill({ status: 404, headers: CORS, body: JSON.stringify({ error: 'No bot in room' }) });
      const current = existing.currentTrack;
      const remaining = existing.queue.filter((item) => item.id !== current?.id).reverse();
      statusByRoom[body.roomId] = {
        ...existing,
        queue: current ? [current, ...remaining] : remaining,
        currentIndex: current ? 0 : existing.currentIndex,
        currentTrack: current ?? remaining[0] ?? null,
      };
      return fulfillSession(body.roomId);
    }

    if (method === 'POST' && pathname.endsWith('/musicman/queue/next')) {
      const body = JSON.parse(route.request().postData() ?? '{}') as { roomId: string };
      const existing = normalizeSession(body.roomId);
      if (!existing) return route.fulfill({ status: 404, headers: CORS, body: JSON.stringify({ error: 'No bot in room' }) });
      const queue = existing.queue.filter((_, index) => index !== existing.currentIndex);
      if (queue.length === 0) {
        activeRooms.delete(body.roomId);
        statusByRoom[body.roomId] = null;
        return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ ok: true, roomId: body.roomId, session: null }) });
      }
      statusByRoom[body.roomId] = {
        ...existing,
        queue,
        currentIndex: 0,
        currentTrack: queue[0],
        url: queue[0].url,
        paused: false,
        playing: true,
      };
      return fulfillSession(body.roomId);
    }

    if (method === 'POST' && pathname.endsWith('/musicman/leave')) {
      const body = JSON.parse(route.request().postData() ?? '{}') as { roomId: string };
      activeRooms.delete(body.roomId);
      statusByRoom[body.roomId] = null;
      return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ success: true }) });
    }

    if (method === 'POST' && pathname.endsWith('/musicman/pause')) {
      const body = JSON.parse(route.request().postData() ?? '{}') as { roomId: string };
      const current = normalizeSession(body.roomId);
      if (current) current.paused = true;
      statusByRoom[body.roomId] = current;
      return fulfillSession(body.roomId);
    }

    if (method === 'POST' && pathname.endsWith('/musicman/resume')) {
      const body = JSON.parse(route.request().postData() ?? '{}') as { roomId: string };
      const current = normalizeSession(body.roomId);
      if (current) current.paused = false;
      statusByRoom[body.roomId] = current;
      return fulfillSession(body.roomId);
    }

    if (method === 'POST' && pathname.endsWith('/musicman/seek')) {
      const body = JSON.parse(route.request().postData() ?? '{}') as { roomId: string; seconds: number };
      const current = normalizeSession(body.roomId);
      const appliedSeconds = clampSeekSeconds(current, body.seconds);
      seekRequests.push({
        roomId: body.roomId,
        requestedSeconds: body.seconds,
        appliedSeconds,
      });
      if (current) current.positionMs = appliedSeconds * 1000;
      statusByRoom[body.roomId] = current;
      return fulfillSession(body.roomId);
    }

    const statusMatch = pathname.match(/\/musicman\/status\/(.+)$/);
    if (method === 'GET' && statusMatch) {
      const roomId = decodeURIComponent(statusMatch[1]);
      const status = normalizeSession(roomId);
      return route.fulfill({
        status: 200,
        headers: CORS,
        body: JSON.stringify(status),
      });
    }

    return route.fulfill({
      status: 404,
      headers: CORS,
      body: JSON.stringify({ error: `Unmocked music route: ${method} ${url}` }),
    });
  });

  return {
    seekRequests,
  };
}

/**
 * Mocks the hub service via page.route() at the network level.
 *
 * Handles OPTIONS preflight (required for cross-origin Authorization header),
 * then routes by method + URL pattern. The hubList array is mutable so
 * POST /api/hubs updates are visible to subsequent GET /api/hubs calls.
 *
 * Handles:
 *   OPTIONS *                    -> 204 with CORS headers
 *   GET  /api/hubs               -> hubList array
 *   POST /api/hubs               -> create hub (appended to hubList)
 *   POST /api/invites/x/redeem   -> redeem invite -> first hub
 *   All other localhost:8080 requests -> 404 with error JSON
 */
export async function mockHubRoutes(
  page: Page,
  hubs = MOCK_HUBS,
  options: {
    channelsByHub?: Record<string, Array<{ id: string; name: string; type: string; hubId: string; position?: number }>>;
    membersByHub?: Record<string, Array<{ id: string; userId: string; hubId: string; alias: string; role: string }>>;
    messagesByChannel?: Record<string, Array<{ id: string; channelId: string; senderId: string; ciphertext: string; iv: string; keyVersion: string; timestamp: string }>>;
    olderMessagesByChannel?: Record<string, Array<{ id: string; channelId: string; senderId: string; ciphertext: string; iv: string; keyVersion: string; timestamp: string }>>;
    ephemeralByHub?: Record<string, { active: boolean; roomId: string | null; expiresAt: number | null }>;
  } = {},
) {
  const hubList = [...hubs];
  const channelsByHub = Object.fromEntries(
    Object.entries(options.channelsByHub ?? MOCK_CHANNELS).map(([hubId, channels]) => [hubId, [...channels]]),
  );
  const membersByHub = Object.fromEntries(
    Object.entries(options.membersByHub ?? MOCK_MEMBERS).map(([hubId, members]) => [hubId, [...members]]),
  );
  const messagesByChannel = Object.fromEntries(
    Object.entries(options.messagesByChannel ?? {}).map(([channelId, messages]) => [channelId, [...messages]]),
  ) as Record<string, Array<{ id: string; channelId: string; senderId: string; ciphertext: string; iv: string; keyVersion: string; timestamp: string }>>;
  const olderMessagesByChannel = Object.fromEntries(
    Object.entries(options.olderMessagesByChannel ?? {}).map(([channelId, messages]) => [channelId, [...messages]]),
  ) as Record<string, Array<{ id: string; channelId: string; senderId: string; ciphertext: string; iv: string; keyVersion: string; timestamp: string }>>;
  const ephemeralByHub = Object.fromEntries(
    hubList.map((hub) => [hub.id, { active: false, roomId: null, expiresAt: null }]),
  ) as Record<string, { active: boolean; roomId: string | null; expiresAt: number | null }>;
  Object.assign(ephemeralByHub, options.ephemeralByHub ?? {});
  const deviceKeysByHub = Object.fromEntries(
    hubList.map((hub) => [hub.id, [] as Array<{ id: string; userId: string; deviceId: string; hubId: string; publicKey: string; updatedAt: string }>]),
  ) as Record<string, Array<{ id: string; userId: string; deviceId: string; hubId: string; publicKey: string; updatedAt: string }>>;
  const bundlesByHub = Object.fromEntries(
    hubList.map((hub) => [hub.id, [] as Array<{ id: string; channelId: string; hubId: string; recipientUserId: string; recipientDeviceId: string; keyVersion: number; senderEphemeralPub: string; ciphertext: string; iv: string; distributorId: string; createdAt: string }>]),
  ) as Record<string, Array<{ id: string; channelId: string; hubId: string; recipientUserId: string; recipientDeviceId: string; keyVersion: number; senderEphemeralPub: string; ciphertext: string; iv: string; distributorId: string; createdAt: string }>>;

  await page.route(/localhost:\d+\/hub\//, async (route) => {
    const method = route.request().method();
    const url = new URL(route.request().url());
    const pathname = url.pathname;

    // Handle CORS preflight (Authorization header triggers OPTIONS)
    if (method === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

    // GET /hub/hubs
    if (method === 'GET' && /\/hub\/hubs$/.test(pathname)) {
      return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(hubList) });
    }

    // POST /hub/hubs - create hub
    if (method === 'POST' && /\/hub\/hubs$/.test(pathname)) {
      const body = JSON.parse(route.request().postData() ?? '{}') as { name: string };
      const newHub = {
        id: `hub-new-${Date.now()}`,
        name: body.name,
        createdAt: new Date().toISOString(),
        ownerId: 'test-user-id',
      };
      hubList.push(newHub);
      channelsByHub[newHub.id] = [];
      membersByHub[newHub.id] = [{ id: `member-${Date.now()}`, userId: 'test-user-id', hubId: newHub.id, username: 'testuser', alias: 'testuser', role: 'owner', joinedAt: new Date().toISOString() }];
      deviceKeysByHub[newHub.id] = [];
      bundlesByHub[newHub.id] = [];
      return route.fulfill({ status: 201, headers: CORS, body: JSON.stringify(newHub) });
    }

    const hubDetailMatch = pathname.match(/\/hub\/hubs\/([^/]+)$/);
    if (method === 'GET' && hubDetailMatch) {
      const hub = hubList.find((entry) => entry.id === hubDetailMatch[1]);
      return route.fulfill({
        status: hub ? 200 : 404,
        headers: CORS,
        body: JSON.stringify(hub ?? { error: 'Hub not found' }),
      });
    }

    const channelMatch = pathname.match(/\/hub\/hubs\/([^/]+)\/channels$/);
    if (method === 'GET' && channelMatch) {
      return route.fulfill({
        status: 200,
        headers: CORS,
        body: JSON.stringify(channelsByHub[channelMatch[1]] ?? []),
      });
    }

    const createChannelMatch = pathname.match(/\/hub\/hubs\/([^/]+)\/channels$/);
    if (method === 'POST' && createChannelMatch) {
      const hubId = createChannelMatch[1];
      const body = JSON.parse(route.request().postData() ?? '{}') as { name: string; type?: string };
      const newChannel = {
        id: `channel-new-${Date.now()}`,
        name: body.name,
        hubId,
        type: body.type ?? 'text',
        createdAt: new Date().toISOString(),
      };
      channelsByHub[hubId] = [...(channelsByHub[hubId] ?? []), newChannel];
      messagesByChannel[newChannel.id] = [];
      return route.fulfill({
        status: 201,
        headers: CORS,
        body: JSON.stringify(newChannel),
      });
    }

    const memberMatch = pathname.match(/\/hub\/hubs\/([^/]+)\/members$/);
    if (method === 'GET' && memberMatch) {
      return route.fulfill({
        status: 200,
        headers: CORS,
        body: JSON.stringify(membersByHub[memberMatch[1]] ?? []),
      });
    }

    const kickMemberMatch = pathname.match(/\/hub\/hubs\/([^/]+)\/members\/([^/]+)$/);
    if (method === 'DELETE' && kickMemberMatch) {
      const hubId = kickMemberMatch[1];
      const memberId = kickMemberMatch[2];
      membersByHub[hubId] = (membersByHub[hubId] ?? []).filter((member) => member.id !== memberId);
      return route.fulfill({
        status: 200,
        headers: CORS,
        body: JSON.stringify({ success: true }),
      });
    }

    const ephemeralMatch = pathname.match(/\/hub\/hubs\/([^/]+)\/ephemeral$/);
    if (method === 'GET' && ephemeralMatch) {
      return route.fulfill({
        status: 200,
        headers: CORS,
        body: JSON.stringify(ephemeralByHub[ephemeralMatch[1]] ?? { active: false, roomId: null, expiresAt: null }),
      });
    }

    if (method === 'POST' && ephemeralMatch) {
      const hubId = ephemeralMatch[1];
      const body = JSON.parse(route.request().postData() ?? '{}') as { roomId?: string };
      ephemeralByHub[hubId] = {
        active: true,
        roomId: body.roomId ?? `ephemeral-${hubId}`,
        expiresAt: Math.floor(Date.now() / 1000) + 300,
      };
      return route.fulfill({
        status: 201,
        headers: CORS,
        body: JSON.stringify(ephemeralByHub[hubId]),
      });
    }

    if (method === 'DELETE' && ephemeralMatch) {
      const hubId = ephemeralMatch[1];
      ephemeralByHub[hubId] = { active: false, roomId: null, expiresAt: null };
      return route.fulfill({
        status: 200,
        headers: CORS,
        body: JSON.stringify({ success: true }),
      });
    }

    const inviteMatch = pathname.match(/\/hub\/hubs\/([^/]+)\/invites$/);
    if (method === 'POST' && inviteMatch) {
      return route.fulfill({
        status: 201,
        headers: CORS,
        body: JSON.stringify({ code: `INVITE-${inviteMatch[1].toUpperCase()}` }),
      });
    }

    const registerDeviceKeyMatch = pathname.match(/\/hub\/hubs\/([^/]+)\/device-key$/);
    if (method === 'PUT' && registerDeviceKeyMatch) {
      const hubId = registerDeviceKeyMatch[1];
      const body = JSON.parse(route.request().postData() ?? '{}') as { deviceId: string; publicKey: string };
      const existing = deviceKeysByHub[hubId] ?? [];
      const next = existing.filter((entry) => entry.deviceId !== body.deviceId);
      next.push({
        id: `device-key-${hubId}-${body.deviceId}`,
        userId: MOCK_USER.sub,
        deviceId: body.deviceId,
        hubId,
        publicKey: body.publicKey,
        updatedAt: new Date().toISOString(),
      });
      deviceKeysByHub[hubId] = next;
      return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ success: true }) });
    }

    const getDeviceKeysMatch = pathname.match(/\/hub\/hubs\/([^/]+)\/device-keys$/);
    if (method === 'GET' && getDeviceKeysMatch) {
      const hubId = getDeviceKeysMatch[1];
      return route.fulfill({
        status: 200,
        headers: CORS,
        body: JSON.stringify(deviceKeysByHub[hubId] ?? []),
      });
    }

    const bundlesMatch = pathname.match(/\/hub\/hubs\/([^/]+)\/channel-keys\/bundles$/);
    if (method === 'GET' && bundlesMatch) {
      const hubId = bundlesMatch[1];
      const channelId = url.searchParams.get('channelId');
      const bundles = bundlesByHub[hubId] ?? [];
      return route.fulfill({
        status: 200,
        headers: CORS,
        body: JSON.stringify(channelId ? bundles.filter((bundle) => bundle.channelId === channelId) : bundles),
      });
    }

    if (method === 'POST' && bundlesMatch) {
      const hubId = bundlesMatch[1];
      const body = JSON.parse(route.request().postData() ?? '{}') as {
        channelId: string;
        keyVersion: number;
        bundles: Array<{ recipientUserId: string; recipientDeviceId: string; senderEphemeralPub: string; ciphertext: string; iv: string }>;
      };
      const existing = bundlesByHub[hubId] ?? [];
      const createdAt = new Date().toISOString();
      for (const bundle of body.bundles ?? []) {
        existing.push({
          id: `bundle-${hubId}-${body.channelId}-${bundle.recipientDeviceId}-${body.keyVersion}-${existing.length + 1}`,
          channelId: body.channelId,
          hubId,
          recipientUserId: bundle.recipientUserId,
          recipientDeviceId: bundle.recipientDeviceId,
          keyVersion: body.keyVersion,
          senderEphemeralPub: bundle.senderEphemeralPub,
          ciphertext: bundle.ciphertext,
          iv: bundle.iv,
          distributorId: MOCK_USER.sub,
          createdAt,
        });
      }
      bundlesByHub[hubId] = existing;
      return route.fulfill({ status: 201, headers: CORS, body: JSON.stringify({ success: true }) });
    }

    const getMessagesMatch = pathname.match(/\/hub\/hubs\/([^/]+)\/channels\/([^/]+)\/messages$/);
    if (method === 'GET' && getMessagesMatch) {
      const channelId = getMessagesMatch[2];
      const before = url.searchParams.get('before');
      if (before) {
        const olderMessages = olderMessagesByChannel[channelId] ?? [];
        olderMessagesByChannel[channelId] = [];
        return route.fulfill({
          status: 200,
          headers: CORS,
          body: JSON.stringify({ messages: olderMessages, hasMore: false }),
        });
      }
      return route.fulfill({
        status: 200,
        headers: CORS,
        body: JSON.stringify({
          messages: messagesByChannel[channelId] ?? [],
          hasMore: (olderMessagesByChannel[channelId] ?? []).length > 0,
        }),
      });
    }

    if (method === 'POST' && getMessagesMatch) {
      const channelId = getMessagesMatch[2];
      const body = JSON.parse(route.request().postData() ?? '{}') as { ciphertext: string; iv: string; keyVersion: string };
      const nextMessage = {
        id: `message-${Date.now()}`,
        channelId,
        senderId: MOCK_USER.sub,
        ciphertext: body.ciphertext,
        iv: body.iv,
        keyVersion: body.keyVersion,
        timestamp: new Date().toISOString(),
      };
      messagesByChannel[channelId] = [...(messagesByChannel[channelId] ?? []), nextMessage];
      return route.fulfill({ status: 201, headers: CORS, body: JSON.stringify(nextMessage) });
    }

    // POST /hub/invites/{code}/redeem
    if (method === 'POST' && /\/hub\/invites\/.+\/redeem$/.test(pathname)) {
      return route.fulfill({
        status: hubList.length > 0 ? 200 : 404,
        headers: CORS,
        body: JSON.stringify({ hub: hubList[0] ?? null }),
      });
    }

    // Fallback
    return route.fulfill({
      status: 404,
      headers: CORS,
      body: JSON.stringify({ error: `Unmocked: ${method} ${url}` }),
    });
  });

  return {
    addChannel(hubId: string, channel: { id: string; name: string; type: string; hubId: string; createdAt?: string; position?: number }) {
      channelsByHub[hubId] = [...(channelsByHub[hubId] ?? []), channel];
    },
    addMember(hubId: string, member: { id: string; userId: string; hubId: string; username: string; alias: string; role: string; joinedAt: string }) {
      membersByHub[hubId] = [...(membersByHub[hubId] ?? []), member];
    },
    removeMember(hubId: string, memberId: string) {
      membersByHub[hubId] = (membersByHub[hubId] ?? []).filter((member) => member.id !== memberId);
    },
    addMessage(channelId: string, message: { id: string; channelId: string; senderId: string; ciphertext: string; iv: string; keyVersion: string; timestamp: string }) {
      messagesByChannel[channelId] = [...(messagesByChannel[channelId] ?? []), message];
    },
    setEphemeral(hubId: string, state: { active: boolean; roomId: string | null; expiresAt: number | null }) {
      ephemeralByHub[hubId] = state;
    },
  };
}

/**
 * Accepts (and silently drops) all WebSocket connections. Prevents
 * ConnectionProvider from throwing errors when the signaling server
 * is unavailable during tests.
 */
export async function mockWebSocket(page: Page) {
  await page.routeWebSocket(/.*/, (ws) => {
    ws.onMessage(() => { /* no-op */ });
  });
}

/**
 * Mocks Socket.IO HTTP long-polling so the transport doesn't stall
 * waiting for a real server. Works together with mockWebSocket().
 */
export async function mockSocketIO(page: Page) {
  await page.route('**/socket.io/**', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=UTF-8',
        body: '97:0{"sid":"test-sid","upgrades":["websocket"],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}2:40',
      });
    }
    return route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' });
  });
}
