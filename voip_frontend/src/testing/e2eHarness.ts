type SocketLike = {
  emit: (event: string, ...args: unknown[]) => unknown;
  listeners?: (event: string) => Array<(...args: unknown[]) => void>;
  _callbacks?: Record<string, Array<(...args: unknown[]) => void>>;
};

type AudioController = {
  addRemoteStream: (peerId: string, alias?: string) => void;
  removeRemoteStream: (peerId: string) => void;
};

type ScreenshareController = {
  addRemoteStream: (peerId: string, alias?: string) => void;
  removeRemoteStream: (peerId: string) => void;
};

export interface AppE2EHarness {
  enabled: boolean;
  registerSocket: (socket: SocketLike) => void;
  emitSocketEvent: (event: string, payload?: unknown) => void;
  getSentSocketEvents: () => Array<{ event: string; payload: unknown }>;
  registerAudioController: (controller: AudioController) => () => void;
  registerScreenshareController: (controller: ScreenshareController) => () => void;
  addRemoteAudioStream: (peerId: string, alias?: string) => void;
  removeRemoteAudioStream: (peerId: string) => void;
  addRemoteScreenshare: (peerId: string, alias?: string) => void;
  removeRemoteScreenshare: (peerId: string) => void;
}

declare global {
  interface Window {
    __APP_E2E__?: AppE2EHarness;
  }
}

export function getAppE2EHarness(): AppE2EHarness | null {
  if (typeof window === 'undefined') return null;
  return window.__APP_E2E__ ?? null;
}

export function isAppE2EEnabled(): boolean {
  return !!getAppE2EHarness()?.enabled;
}
