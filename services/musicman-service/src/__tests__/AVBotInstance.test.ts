jest.mock('socket.io-client', () => {
  const mockSocket = {
    connected: false,
    emit: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
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
    createOffer:          jest.fn().mockResolvedValue({ type: 'offer', sdp: '' }),
    createAnswer:         jest.fn().mockResolvedValue({ type: 'answer', sdp: '' }),
    setLocalDescription:  jest.fn().mockResolvedValue(undefined),
    addIceCandidate:      jest.fn().mockResolvedValue(undefined),
    close:                jest.fn(),
    connectionState:      'new',
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

jest.mock('../pipelines/AVPipeline', () => ({
  AVPipeline: jest.fn().mockImplementation(() => ({
    start: jest.fn(), stop: jest.fn(), pause: jest.fn(), resume: jest.fn(), seek: jest.fn(),
    on: jest.fn(), removeListener: jest.fn(), running: false, isPaused: false, positionMs: 0,
  })),
  VP8_PAYLOAD_TYPE:  96,
  VP8_TIMESTAMP_STEP: 3000,
}));

import { AVBotInstance } from '../instances/AVBotInstance';
import { AVPipeline } from '../pipelines/AVPipeline';

const mockTurnCredentials = { username: 'turn-user', password: 'turn-pass', ttl: 3600 };
const TEST_URL = 'https://www.youtube.com/watch?v=test123';

function makeBot() {
  return new AVBotInstance('room-test', TEST_URL, 'mock-token', mockTurnCredentials);
}

describe('AVBotInstance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AVPipeline as unknown as jest.Mock).mockImplementation(() => ({
      start: jest.fn(), stop: jest.fn(), pause: jest.fn(), resume: jest.fn(), seek: jest.fn(),
      on: jest.fn(), removeListener: jest.fn(), running: false, isPaused: false, positionMs: 0,
    }));
  });

  describe('constructor', () => {
    it('creates an AVPipeline with the url', () => {
      makeBot();
      expect(AVPipeline).toHaveBeenCalledWith(TEST_URL);
    });

    it('sets roomId correctly', () => {
      expect(makeBot().roomId).toBe('room-test');
    });
  });

  describe('getStatus()', () => {
    it('returns correct initial state with videoMode=true', () => {
      expect(makeBot().getStatus()).toMatchObject({
        playing:    false,
        paused:     false,
        positionMs: 0,
        url: TEST_URL,
        videoMode:  true,
      });
    });
  });

  describe('pause()', () => {
    it('calls avPipeline.pause()', () => {
      const bot = makeBot();
      bot.pause();
      expect((bot as any).avPipeline.pause).toHaveBeenCalled();
    });
  });

  describe('resume()', () => {
    it('calls avPipeline.resume()', () => {
      const bot = makeBot();
      bot.resume();
      expect((bot as any).avPipeline.resume).toHaveBeenCalled();
    });
  });

  describe('seek(ms)', () => {
    it('calls avPipeline.seek(ms)', () => {
      const bot = makeBot();
      bot.seek(15000);
      expect((bot as any).avPipeline.seek).toHaveBeenCalledWith(15000);
    });
  });

  describe('changeTrack(url)', () => {
    it('stops old avPipeline and creates new AVPipeline with new url', () => {
      const bot          = makeBot();
      const oldAvPipeline = (bot as any).avPipeline;
      const newUrl       = 'https://www.youtube.com/watch?v=newvideo';
      bot.changeTrack(newUrl);
      expect(oldAvPipeline.stop).toHaveBeenCalled();
      expect(AVPipeline).toHaveBeenLastCalledWith(newUrl);
    });

    it('does nothing when bot is destroyed', () => {
      const bot = makeBot();
      (bot as any).destroyed = true;
      const spy = jest.spyOn(bot as any, 'emitToRoom');
      bot.changeTrack('https://www.youtube.com/watch?v=ignored');
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('destroy()', () => {
    it('stops the avPipeline', () => {
      const bot        = makeBot();
      const avPipeline = (bot as any).avPipeline;
      bot.destroy();
      expect(avPipeline.stop).toHaveBeenCalled();
    });

    it('sets destroyed=true preventing double-destroy', () => {
      const bot        = makeBot();
      const avPipeline = (bot as any).avPipeline;
      bot.destroy();
      bot.destroy();
      expect(avPipeline.stop).toHaveBeenCalledTimes(1);
    });

    it('emits screenshare-stopped and leave-room when socket is connected', () => {
      const bot        = makeBot();
      const mockSocket = { connected: true, emit: jest.fn(), disconnect: jest.fn() };
      (bot as any).socket = mockSocket;
      bot.destroy();
      expect(mockSocket.emit).toHaveBeenCalledWith('screenshare-stopped');
      expect(mockSocket.emit).toHaveBeenCalledWith('leave-room', { roomId: 'room-test' });
    });

    it('calls socket.disconnect() if connected', () => {
      const bot        = makeBot();
      const mockSocket = { connected: true, emit: jest.fn(), disconnect: jest.fn() };
      (bot as any).socket = mockSocket;
      bot.destroy();
      expect(mockSocket.disconnect).toHaveBeenCalled();
    });

    it('calls screenPeerWs.close() if it exists', () => {
      const bot    = makeBot();
      const mockWs = { close: jest.fn() };
      (bot as any).screenPeerWs = mockWs;
      bot.destroy();
      expect(mockWs.close).toHaveBeenCalled();
    });

    it('calls peerWs.close() if it exists', () => {
      const bot    = makeBot();
      const mockWs = { close: jest.fn() };
      (bot as any).peerWs = mockWs;
      bot.destroy();
      expect(mockWs.close).toHaveBeenCalled();
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
});