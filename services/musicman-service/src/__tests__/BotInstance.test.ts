jest.mock('socket.io-client', () => {
  const mockSocket = {
    connected: false,
    emit: jest.fn(),
    on: jest.fn(),
    disconnect: jest.fn(),
  };
  return { io: jest.fn().mockReturnValue(mockSocket) };
});

jest.mock('ws', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    send: jest.fn(),
    close: jest.fn(),
    readyState: 1,
  }));
});

jest.mock('werift', () => ({
  RTCPeerConnection: jest.fn().mockImplementation(() => ({
    addTransceiver:       jest.fn().mockReturnValue({ sender: { track: {} } }),
    setRemoteDescription: jest.fn().mockResolvedValue(undefined),
    createAnswer:         jest.fn().mockResolvedValue({ type: 'answer', sdp: '' }),
    setLocalDescription:  jest.fn().mockResolvedValue(undefined),
    addIceCandidate:      jest.fn().mockResolvedValue(undefined),
    close:                jest.fn(),
    connectionState:      'new',
    iceConnectionState:   'new',
    onicecandidate:       null,
    onconnectionstatechange: null,
  })),
  RTCSessionDescription: jest.fn(),
  RTCIceCandidate:       jest.fn(),
  MediaStreamTrack:      jest.fn().mockImplementation(() => ({
    writeRtp: jest.fn(),
    stop:     jest.fn(),
  })),
  useVP8:  jest.fn().mockReturnValue({}),
  useOPUS: jest.fn().mockReturnValue({}),
}));

jest.mock('../pipelines/AudioPipeline', () => ({
  AudioPipeline: jest.fn().mockImplementation(() => ({
    start: jest.fn(), stop: jest.fn(), pause: jest.fn(), resume: jest.fn(), seek: jest.fn(),
    on: jest.fn(), removeListener: jest.fn(), running: false, isPaused: false, positionMs: 0,
  })),
  OPUS_FRAME_MS:      20,
  SAMPLE_RATE:        48000,
  RTP_TIMESTAMP_STEP: 960,
}));

import { EventEmitter } from 'events';
import { BotInstance } from '../instances/BotInstance';
import { AudioPipeline } from '../pipelines/AudioPipeline';

const mockTurnCredentials = { username: 'turn-user', password: 'turn-pass', ttl: 3600 };
const TEST_URL = 'https://www.youtube.com/watch?v=test123';

function captureStdoutLogs() {
  const writes: string[] = [];
  const spy = jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    writes.push(chunk.toString());
    return true;
  }) as typeof process.stdout.write);

  return {
    spy,
    entries: () => writes
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

function makeBot() {
  return new BotInstance('room-test', TEST_URL, 'mock-token', mockTurnCredentials);
}

function makeMockPipeline() {
  const emitter = new EventEmitter() as EventEmitter & {
    start: jest.Mock;
    stop: jest.Mock;
    pause: jest.Mock;
    resume: jest.Mock;
    seek: jest.Mock;
    running: boolean;
    isPaused: boolean;
    positionMs: number;
  };
  emitter.start = jest.fn();
  emitter.stop = jest.fn();
  emitter.pause = jest.fn();
  emitter.resume = jest.fn();
  emitter.seek = jest.fn();
  emitter.running = false;
  emitter.isPaused = false;
  emitter.positionMs = 0;
  return emitter;
}

describe('BotInstance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AudioPipeline as unknown as jest.Mock).mockImplementation(() => makeMockPipeline());
  });

  describe('constructor', () => {
    it('creates an AudioPipeline with the url', () => {
      makeBot();
      expect(AudioPipeline).toHaveBeenCalledWith(TEST_URL, 'Bot:room-test');
    });

    it('sets roomId correctly', () => {
      expect(makeBot().roomId).toBe('room-test');
    });
  });

  describe('getStatus()', () => {
    it('returns correct initial state', () => {
      expect(makeBot().getStatus()).toMatchObject({
        playing:    false,
        paused:     false,
        positionMs: 0,
        url: TEST_URL,
      });
    });
  });

  describe('pause()', () => {
    it('calls pipeline.pause()', () => {
      const bot = makeBot();
      bot.pause();
      expect((bot as any).pipeline.pause).toHaveBeenCalled();
    });
  });

  describe('resume()', () => {
    it('calls pipeline.resume()', () => {
      const bot = makeBot();
      bot.resume();
      expect((bot as any).pipeline.resume).toHaveBeenCalled();
    });
  });

  describe('seek(ms)', () => {
    it('calls pipeline.seek(ms)', () => {
      const bot = makeBot();
      bot.seek(15000);
      expect((bot as any).pipeline.seek).toHaveBeenCalledWith(15000);
    });
  });

  describe('changeTrack(url)', () => {
    it('stops old pipeline and creates new AudioPipeline with new url', () => {
      const bot        = makeBot();
      const oldPipeline = (bot as any).pipeline;
      const newUrl     = 'https://www.youtube.com/watch?v=newtrack';
      bot.changeTrack(newUrl);
      expect(oldPipeline.stop).toHaveBeenCalled();
      expect(AudioPipeline).toHaveBeenLastCalledWith(newUrl, 'Bot:room-test');
    });

    it('does nothing when bot is destroyed', () => {
      const bot = makeBot();
      (bot as any).destroyed = true;
      const spy = jest.spyOn(bot as any, 'emitToRoom');
      bot.changeTrack('https://www.youtube.com/watch?v=ignored');
      expect(spy).not.toHaveBeenCalled();
    });

    it('logs the previous and next url', () => {
      const logCapture = captureStdoutLogs();
      const bot = makeBot();
      const newUrl = 'https://www.youtube.com/watch?v=newtrack';

      bot.changeTrack(newUrl);

      const entry = logCapture.entries().find((log) => log.message === 'bot.change_track');
      expect(entry).toMatchObject({
        message: 'bot.change_track',
        context: 'botInstance',
        previousUrl: TEST_URL,
        nextUrl: newUrl,
      });
      logCapture.spy.mockRestore();
    });

    it('ignores ended events from the old pipeline after changing track', () => {
      const bot = makeBot();
      const onTrackEnded = jest.fn();
      bot.setTrackEndedCallback(onTrackEnded);

      (bot as any).wirePipeline();
      const oldPipeline = (bot as any).pipeline as ReturnType<typeof makeMockPipeline>;

      bot.changeTrack('https://www.youtube.com/watch?v=newtrack');
      const newPipeline = (bot as any).pipeline as ReturnType<typeof makeMockPipeline>;

      expect(oldPipeline.listenerCount('ended')).toBe(0);
      expect(newPipeline.listenerCount('ended')).toBe(1);

      oldPipeline.emit('ended', 0);
      expect(onTrackEnded).not.toHaveBeenCalled();

      newPipeline.emit('ended', 0);
      expect(onTrackEnded).toHaveBeenCalledTimes(1);
    });
  });

  describe('destroy()', () => {
    it('stops the pipeline', () => {
      const bot      = makeBot();
      const pipeline = (bot as any).pipeline;
      bot.destroy();
      expect(pipeline.stop).toHaveBeenCalled();
    });

    it('sets destroyed=true preventing double-destroy', () => {
      const bot      = makeBot();
      const pipeline = (bot as any).pipeline;
      bot.destroy();
      bot.destroy();
      expect(pipeline.stop).toHaveBeenCalledTimes(1);
    });

    it('emits leave-room when socket is connected', () => {
      const bot        = makeBot();
      const mockSocket = { connected: true, emit: jest.fn(), disconnect: jest.fn() };
      (bot as any).socket = mockSocket;
      bot.destroy();
      expect(mockSocket.emit).toHaveBeenCalledWith('leave-room', { roomId: 'room-test' });
    });

    it('calls socket.disconnect() if connected', () => {
      const bot        = makeBot();
      const mockSocket = { connected: true, emit: jest.fn(), disconnect: jest.fn() };
      (bot as any).socket = mockSocket;
      bot.destroy();
      expect(mockSocket.disconnect).toHaveBeenCalled();
    });

    it('calls peerWs.close() if peer websocket exists', () => {
      const bot    = makeBot();
      const mockWs = { close: jest.fn() };
      (bot as any).peerWs = mockWs;
      bot.destroy();
      expect(mockWs.close).toHaveBeenCalled();
    });

    it('logs the destroy reason', () => {
      const logCapture = captureStdoutLogs();
      const bot = makeBot();

      bot.destroy('room_closed');

      const entry = logCapture.entries().find((log) => log.message === 'bot.destroying');
      expect(entry).toMatchObject({
        message: 'bot.destroying',
        context: 'botInstance',
        reason: 'room_closed',
        mode: 'audio',
      });
      logCapture.spy.mockRestore();
    });
  });

  describe('setAutoLeaveCallback', () => {
    it('stores the callback', () => {
      const bot = makeBot();
      const cb  = jest.fn();
      bot.setAutoLeaveCallback(cb);
      expect((bot as any).onAutoLeave).toBe(cb);
    });
  });

  describe('onAllUsers()', () => {
    it('calls existing room peers before starting playback', async () => {
      const bot = makeBot();
      const callPeerSpy = jest.spyOn(bot as any, 'callPeer').mockResolvedValue(undefined);
      const pipelineStartSpy = (bot as any).pipeline.start as jest.Mock;
      (bot as any).myPeerId = 'peer-self';

      await (bot as any).onAllUsers([
        { peerId: 'peer-a', alias: 'alice', userId: 'user-a' },
        { peerId: 'peer-b', alias: 'bob', userId: 'user-b' },
        { peerId: 'peer-self', alias: 'musicman', userId: 'musicman' },
      ]);

      expect(callPeerSpy).toHaveBeenCalledTimes(2);
      expect(callPeerSpy).toHaveBeenCalledWith('peer-a');
      expect(callPeerSpy).toHaveBeenCalledWith('peer-b');
      expect(pipelineStartSpy).toHaveBeenCalled();
    });
  });
});
