import { io, Socket } from 'socket.io-client';
import WebSocket from 'ws';
import { v4 as uuid } from 'uuid';
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  MediaStreamTrack,
  type RTCRtpTransceiver,
} from 'werift';
import {
  AudioPipeline,
  RTP_TIMESTAMP_STEP,
  type OpusFrame,
} from './AudioPipeline';
import { AVPipeline, VP8_PAYLOAD_TYPE, VP8_TIMESTAMP_STEP } from './AVPipeline';
import { config } from './config';

const OPUS_PAYLOAD_TYPE = 111;

// Audio-only peer (non-video mode)

interface PeerConn {
  pc:           RTCPeerConnection;
  track:        MediaStreamTrack;
  transceiver:  RTCRtpTransceiver;
  connectionId: string;
  ssrc:         number;
  seq:          number;
  timestamp:    number;
}

/** AV peer (video mode) = one PC, both tracks
    Audio and video share a single RTCPeerConnection so the browser receives
    Without this desync errors will fry you **/

interface AVPeerConn {
  pc:               RTCPeerConnection;
  audioTrack:       MediaStreamTrack;
  audioTransceiver: RTCRtpTransceiver;
  videoTrack:       MediaStreamTrack;
  videoTransceiver: RTCRtpTransceiver;
  connectionId:     string;
  audioSsrc:        number;
  audioSeq:         number;
  audioTimestamp:   number;
  videoSsrc:        number;
  videoSeq:         number;
  videoTimestamp:   number;
}

type IceEntry = { candidate: string; sdpMid?: string; sdpMLineIndex?: number };
type AllUsersPayload      = Array<{ peerId: string; alias: string; userId: string }>;
type UserConnectedPayload = { peerId: string; alias: string };

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'turn:10.10.10.10:3478', username: 'talk', credential: 'talkpass' },
];

const VP8_MAX_RTP_PAYLOAD = 1_200;

export class BotInstance {
  private socket:   Socket | null = null;
  private peerWs:   WebSocket | null = null;
  private myPeerId: string | null = null;

  private pipeline:   AudioPipeline;
  private youtubeUrl: string;
  private conns       = new Map<string, PeerConn>();
  private iceBuf      = new Map<string, IceEntry[]>();
  private hbTimer:    NodeJS.Timeout | null = null;
  private destroyed   = false;
  private frameQueue: OpusFrame[] = [];
  private isConnected = false;

  private videoMode:     boolean;
  private avPipeline:    AVPipeline | null = null;
  private screenPeerId:  string | null = null;
  private screenPeerWs:  WebSocket | null = null;
  private avConns        = new Map<string, AVPeerConn>();
  private avIceBuf       = new Map<string, IceEntry[]>();
  private screenHbTimer: NodeJS.Timeout | null = null;

  private onAutoLeave: (() => void) | null = null;

  readonly roomId: string;

  constructor(roomId: string, youtubeUrl: string, private readonly token: string, videoMode = false) {
    this.roomId     = roomId;
    this.youtubeUrl = youtubeUrl;
    this.videoMode  = videoMode;
    this.pipeline   = new AudioPipeline(youtubeUrl);
    if (videoMode) this.avPipeline = new AVPipeline(youtubeUrl);
  }

  setAutoLeaveCallback(cb: () => void): void {
    this.onAutoLeave = cb;
  }

  private readonly onAudioFrame = (frame: OpusFrame) => {
    if (this.videoMode) {
      // In video mode audio goes through the AV peer connections
      for (const conn of this.avConns.values()) this.sendOpusFrameAV(conn, frame);
    } else {
      if (this.isConnected) {
        for (const conn of this.conns.values()) this.sendOpusFrame(conn, frame);
      } else {
        this.frameQueue.push(frame);
      }
    }
  };

  private readonly onVideoFrame = (frameData: Buffer) => {
    for (const conn of this.avConns.values()) this.sendVP8Frame(conn, frameData);
  };

  private readonly onEnded = (code: number | null) => {
    console.log(`[Bot ${this.roomId}] Pipeline ended (exit ${code})`);
    this.emitToRoom('musicman:track-ended', { roomId: this.roomId });
  };

  private readonly onPipelineError = (e: Error) =>
    console.error(`[Bot ${this.roomId}] Pipeline error:`, e);

  private wirePipeline(): void {
    this.pipeline.on('frame', this.onAudioFrame);
    this.pipeline.on('ended', this.onEnded);
    this.pipeline.on('error', this.onPipelineError);
  }

  private unwirePipeline(): void {
    this.pipeline.removeListener('frame', this.onAudioFrame);
    this.pipeline.removeListener('ended', this.onEnded);
    this.pipeline.removeListener('error', this.onPipelineError);
  }

  private wireAVPipeline(): void {
    this.avPipeline!.on('audioFrame', this.onAudioFrame);
    this.avPipeline!.on('videoFrame', this.onVideoFrame);
    this.avPipeline!.on('ended',      this.onEnded);
    this.avPipeline!.on('error',      this.onPipelineError);
  }

  private unwireAVPipeline(): void {
    this.avPipeline!.removeListener('audioFrame', this.onAudioFrame);
    this.avPipeline!.removeListener('videoFrame', this.onVideoFrame);
    this.avPipeline!.removeListener('ended',      this.onEnded);
    this.avPipeline!.removeListener('error',      this.onPipelineError);
  }

  private get activePipeline(): AudioPipeline | AVPipeline {
    return (this.videoMode && this.avPipeline) ? this.avPipeline : this.pipeline;
  }

  async start(): Promise<void> {
    if (this.videoMode && this.avPipeline) {
      this.wireAVPipeline();
    } else {
      this.wirePipeline();
    }
    await this.connectSignaling();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    console.log(`[Bot ${this.roomId}] Destroying`);

    if (this.videoMode) {
      this.unwireAVPipeline();
      this.avPipeline?.stop();
      if (this.screenHbTimer) { clearInterval(this.screenHbTimer); this.screenHbTimer = null; }
      for (const peerId of [...this.avConns.keys()]) this.closeAVPeer(peerId);
      if (this.socket?.connected) this.socket.emit('screenshare-stopped');
      this.screenPeerWs?.close();
      this.screenPeerWs = null;
    } else {
      this.unwirePipeline();
      this.pipeline.stop();
    }

    this.frameQueue = [];
    if (this.hbTimer) { clearInterval(this.hbTimer); this.hbTimer = null; }
    for (const peerId of [...this.conns.keys()]) this.closePeer(peerId);

    if (this.socket?.connected) {
      this.socket.emit('leave-room', { roomId: this.roomId });
      this.socket.disconnect();
    }
    this.peerWs?.close();
  }

  changeTrack(url: string): void {
    if (this.destroyed) return;
    console.log(`[Bot ${this.roomId}] changeTrack → ${url}`);
    this.youtubeUrl = url;

    if (this.videoMode && this.avPipeline) {
      this.unwireAVPipeline();
      this.avPipeline.stop();
      this.avPipeline = new AVPipeline(url);
      this.wireAVPipeline();
      this.avPipeline.start();
    } else {
      this.unwirePipeline();
      this.pipeline.stop();
      this.frameQueue = [];
      this.pipeline = new AudioPipeline(url);
      this.wirePipeline();
      this.pipeline.start();
    }

    this.emitToRoom('musicman:track-changed', { roomId: this.roomId, youtubeUrl: url });
  }

  pause(): void {
    this.activePipeline.pause();
    this.emitToRoom('musicman:state-changed', {
      roomId: this.roomId, playing: this.activePipeline.running, paused: true,
    });
  }

  resume(): void {
    this.activePipeline.resume();
    this.emitToRoom('musicman:state-changed', {
      roomId: this.roomId, playing: this.activePipeline.running, paused: false,
    });
  }

  seek(ms: number): void { this.activePipeline.seek(ms); }

  getStatus(): { playing: boolean; paused: boolean; positionMs: number; youtubeUrl: string; videoMode: boolean; screenPeerId: string | null } {
    const ap = this.activePipeline;
    return {
      playing:      ap.running,
      paused:       ap.isPaused,
      positionMs:   ap.positionMs,
      youtubeUrl:   this.youtubeUrl,
      videoMode:    this.videoMode,
      screenPeerId: this.screenPeerId,
    };
  }

  private emitToRoom(event: string, data: Record<string, unknown>): void {
    if (this.socket?.connected) this.socket.emit(event, data);
  }

  private checkAutoLeave(): void {
    const peerCount = this.videoMode ? this.avConns.size : this.conns.size;
    if (peerCount === 0) {
      console.log(`[Bot ${this.roomId}] No peers connected, triggering auto-leave`);
      this.onAutoLeave?.();
    }
  }

  private getPeerCount(): number {
    return this.videoMode ? this.avConns.size : this.conns.size;
  }

  private connectSignaling(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = io(config.SIGNALING_URL, {
        auth: { token: this.token, username: config.BOT_USERNAME },
        transports: ['websocket'],
      });

      const timer = setTimeout(
        () => reject(new Error(`[Bot ${this.roomId}] Socket.IO connection timed out`)),
        15_000,
      );

      this.socket.on(config.PEER_ID_EVENT, async (payload: Record<string, string>) => {
        clearTimeout(timer);
        const peerId = payload[config.PEER_ID_KEY];

        if (!peerId) {
          return reject(new Error(
            `[Bot ${this.roomId}] '${config.PEER_ID_EVENT}' fired but key '${config.PEER_ID_KEY}' was missing. Payload: ${JSON.stringify(payload)}`,
          ));
        }

        this.myPeerId = peerId;
        console.log(`[Bot ${this.roomId}] Assigned peer ID: ${peerId}`);

        try {
          await this.connectPeerWs(peerId);
          this.socket!.emit('join-room', {
            roomId: this.roomId,
            alias:  '🎵 Music Bot',
            userId: config.BOT_USERNAME,
          });

          if (this.videoMode && this.avPipeline) {
            const screenPeerId = await this.requestScreenPeerId();
            this.screenPeerId = screenPeerId;
            await this.connectScreenPeerWs(screenPeerId);
            this.avPipeline.start();
            this.socket!.emit('screenshare-started', { screenPeerId });
            console.log(`[Bot ${this.roomId}] AV stream started - screen peer: ${screenPeerId}`);
          } else {
            this.pipeline.start();
          }

          resolve();
        } catch (err) {
          reject(err);
        }
      });

      this.socket.on('all-users', (users: AllUsersPayload) => {
        console.log(`[Bot ${this.roomId}] all-users (${users.length}):`, users.map(u => u.alias));
      });

      this.socket.on('user-connected', ({ peerId, alias }: UserConnectedPayload) => {
        console.log(`[Bot ${this.roomId}] user-connected: ${alias} (${peerId})`);
      });

      this.socket.on('room-screen-peers', ({ peers }: { peers: Array<{ screenPeerId: string; alias: string }> }) => {
        console.log(`[Bot ${this.roomId}] room-screen-peers: ${peers.length} peer(s)`);
        for (const { screenPeerId, alias } of peers) {
          this.callFrontendScreenPeer(screenPeerId, alias);
        }
      });

      this.socket.on('new-screen-peer', ({ screenPeerId, alias }: { screenPeerId: string; alias: string }) => {
        console.log(`[Bot ${this.roomId}] new-screen-peer: ${alias} (${screenPeerId})`);
        this.callFrontendScreenPeer(screenPeerId, alias);
      });

      this.socket.on('user-disconnected', (peerId: string) => {
        console.log(`[Bot ${this.roomId}] user-disconnected: ${peerId}`);
        this.closePeer(peerId);
      });

      this.socket.on('room-closed', () => { this.destroy(); });

      this.socket.on('join-error', ({ message: msg }: { message: string }) =>
        console.error(`[Bot ${this.roomId}] join-error: ${msg}`));

      this.socket.on('connect_error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private requestScreenPeerId(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`[Bot ${this.roomId}] screen peer ID request timed out`)),
        10_000,
      );
      this.socket!.once('screen-peer-assigned', (payload: Record<string, string>) => {
        clearTimeout(timeout);
        const id = payload['peerId'];
        if (!id) return reject(new Error(`[Bot ${this.roomId}] screen-peer-assigned missing peerId`));
        resolve(id);
      });
      this.socket!.emit('request-screen-peer-id');
    });
  }

  // ── Audio-only PeerJS WS (non-video mode) ────────────────────────────────

  private connectPeerWs(peerId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const { PEER_HOST, PEER_PORT, PEER_PATH, PEER_SECURE } = config;
      const proto = PEER_SECURE ? 'wss' : 'ws';
      const path  = PEER_PATH.endsWith('/') ? PEER_PATH : `${PEER_PATH}/`;
      const wsUrl = `${proto}://${PEER_HOST}:${PEER_PORT}${path}peerjs?key=peerjs&id=${encodeURIComponent(peerId)}&token=${uuid()}`;

      console.log(`[PeerWS ${this.roomId}] Connecting → ${wsUrl}`);
      this.peerWs = new WebSocket(wsUrl);

      const timer = setTimeout(
        () => reject(new Error(`[Bot ${this.roomId}] PeerJS WS timed out`)),
        10_000,
      );

      this.peerWs.on('open', () => {
        this.hbTimer = setInterval(() => {
          if (this.peerWs?.readyState === WebSocket.OPEN) {
            this.peerWs.send(JSON.stringify({ type: 'HEARTBEAT' }));
          } else {
            clearInterval(this.hbTimer!);
            this.hbTimer = null;
          }
        }, 5_000);
      });

      this.peerWs.on('message', async (raw: WebSocket.RawData) => {
        let msg: { type: string; src: string; dst: string; payload: Record<string, unknown> };
        try { msg = JSON.parse(raw.toString()); } catch { return; }

        switch (msg.type) {
          case 'OPEN':     clearTimeout(timer); console.log(`[PeerWS ${this.roomId}] Open ✓`); resolve(); break;
          case 'OFFER':
            // In video mode, audio+video are handled through the screen peer WS.
            // Ignore incoming audio-only offers from the frontend.
            if (!this.videoMode) await this.onOffer(msg.src, msg.payload);
            break;
          case 'ANSWER':   await this.onAnswer(msg.src, msg.payload);   break;
          case 'CANDIDATE': await this.onCandidate(msg.src, msg.payload); break;
          case 'LEAVE':
          case 'EXPIRE':   this.closePeer(msg.src); break;
          case 'ERROR':    console.error(`[PeerWS ${this.roomId}] Server error:`, msg.payload); break;
          case 'ID-TAKEN': reject(new Error(`[Bot ${this.roomId}] Peer ID already taken: ${peerId}`)); break;
        }
      });

      this.peerWs.on('error', (err) => { clearTimeout(timer); reject(err); });
      this.peerWs.on('close', () => {
        if (this.hbTimer) { clearInterval(this.hbTimer); this.hbTimer = null; }
        if (!this.destroyed) console.warn(`[PeerWS ${this.roomId}] WebSocket closed unexpectedly`);
      });
    });
  }

  private sendPeer(type: string, dst: string, payload: Record<string, unknown>): void {
    if (this.peerWs?.readyState !== WebSocket.OPEN) return;
    this.peerWs.send(JSON.stringify({ type, src: this.myPeerId, dst, payload }));
  }

  // ── Audio-only peer connections (non-video mode) ──────────────────────────

  private makePc(remotePeerId: string, connectionId: string): PeerConn {
    const pc          = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const track       = new MediaStreamTrack({ kind: 'audio' });
    const transceiver = pc.addTransceiver(track, { direction: 'sendonly' });

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        setTimeout(() => {
          this.sendPeer('CANDIDATE', remotePeerId, {
            candidate: candidate.toJSON(), connectionId, type: 'media',
          });
        }, 100);
      }
    };

    pc.addEventListener('connectionstatechange', () => {
      const state = pc.connectionState;
      console.log(`[PC ${this.roomId}→${remotePeerId}] state: ${state}`);
      if (state === 'connected') {
        this.isConnected = true;
        const conn = this.conns.get(remotePeerId);
        if (conn && this.frameQueue.length > 0) {
          console.log(`[Bot ${this.roomId}] Flushing ${this.frameQueue.length} buffered frames`);
          for (const frame of this.frameQueue) this.sendOpusFrame(conn, frame);
          this.frameQueue = [];
        }
      }
      if (state === 'failed' || state === 'closed') {
        this.isConnected = this.conns.size > 1;
        this.closePeer(remotePeerId);
      }
    });

    const conn: PeerConn = {
      pc, track, transceiver, connectionId,
      ssrc:      Math.floor(Math.random() * 0xFFFFFFFF),
      seq:       Math.floor(Math.random() * 0xFFFF),
      timestamp: Math.floor(Math.random() * 0xFFFFFFFF),
    };
    this.conns.set(remotePeerId, conn);
    return conn;
  }

  private async onOffer(remotePeerId: string, payload: Record<string, unknown>): Promise<void> {
    if (this.destroyed) return;
    if (this.conns.has(remotePeerId)) {
      if (this.myPeerId! < remotePeerId) return;
      this.closePeer(remotePeerId);
    }

    const connectionId = payload.connectionId as string;
    console.log(`[Bot ${this.roomId}] ← Answering offer from ${remotePeerId}`);

    const conn = this.makePc(remotePeerId, connectionId);

    const sdpObj  = payload.sdp as { sdp: string; type: string } | string;
    const sdpStr  = typeof sdpObj === 'string' ? sdpObj : sdpObj.sdp;
    const sdpType = typeof sdpObj === 'string' ? payload.type as string : sdpObj.type;

    await conn.pc.setRemoteDescription(new RTCSessionDescription(sdpStr, sdpType as 'offer' | 'answer'));
    await this.drainIceBuf(remotePeerId, conn.pc);

    const answer = await conn.pc.createAnswer();
    await conn.pc.setLocalDescription(answer);

    this.sendPeer('ANSWER', remotePeerId, {
      sdp: { sdp: answer.sdp, type: answer.type }, connectionId, browser: 'node-bot',
    });
  }

  private async onAnswer(remotePeerId: string, payload: Record<string, unknown>): Promise<void> {
    const conn = this.conns.get(remotePeerId);
    if (!conn) return;
    const sdpObj  = payload.sdp as { sdp: string; type: string } | string;
    const sdpStr  = typeof sdpObj === 'string' ? sdpObj : sdpObj.sdp;
    const sdpType = typeof sdpObj === 'string' ? payload.type as string : sdpObj.type;
    await conn.pc.setRemoteDescription(new RTCSessionDescription(sdpStr, sdpType as 'offer' | 'answer'));
    await this.drainIceBuf(remotePeerId, conn.pc);
  }

  private async onCandidate(remotePeerId: string, payload: Record<string, unknown>): Promise<void> {
    const raw = payload.candidate as IceEntry | null;
    if (!raw) return;
    const conn = this.conns.get(remotePeerId);
    if (!conn?.pc.remoteDescription) {
      const buf = this.iceBuf.get(remotePeerId) ?? [];
      buf.push(raw);
      this.iceBuf.set(remotePeerId, buf);
      return;
    }
    try { await conn.pc.addIceCandidate(new RTCIceCandidate(raw)); } catch (err) {
      console.warn(`[Bot ${this.roomId}] ICE candidate error for ${remotePeerId}:`, err);
    }
  }

  private async drainIceBuf(peerId: string, pc: RTCPeerConnection): Promise<void> {
    const buf = this.iceBuf.get(peerId) ?? [];
    this.iceBuf.delete(peerId);
    for (const cand of buf) {
      try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch { /* stale */ }
    }
  }

  private closePeer(peerId: string): void {
    const conn = this.conns.get(peerId);
    if (!conn) return;
    try { conn.pc.close(); } catch {}
    this.conns.delete(peerId);
    this.iceBuf.delete(peerId);
    console.log(`[Bot ${this.roomId}] Closed audio peer: ${peerId}`);
    this.checkAutoLeave();
  }

  private _rtpLogCount = 0;

  private sendOpusFrame(conn: PeerConn, frame: OpusFrame): void {
    if (conn.pc.connectionState !== 'connected') return;
    conn.seq       = (conn.seq + 1) & 0xFFFF;
    conn.timestamp = (conn.timestamp + RTP_TIMESTAMP_STEP) >>> 0;
    const header = Buffer.alloc(12);
    header[0] = 0x80;
    header[1] = OPUS_PAYLOAD_TYPE & 0x7F;
    header.writeUInt16BE(conn.seq, 2);
    header.writeUInt32BE(conn.timestamp, 4);
    header.writeUInt32BE(conn.ssrc, 8);
    const pkt = Buffer.concat([header, frame.data]);
    try {
      conn.track.writeRtp(pkt);
      if (this._rtpLogCount < 3) {
        this._rtpLogCount++;
        console.log(`[Bot ${this.roomId}] writeRtp ok #${this._rtpLogCount} - ssrc: ${conn.ssrc}, seq: ${conn.seq}, pt: ${OPUS_PAYLOAD_TYPE}, bytes: ${pkt.length}`);
      }
    } catch (e) {
      if (this._rtpLogCount < 3) {
        this._rtpLogCount++;
        console.error(`[Bot ${this.roomId}] writeRtp ERROR #${this._rtpLogCount}:`, e);
      }
    }
  }

  private connectScreenPeerWs(screenPeerId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const { PEER_HOST, PEER_PORT, PEER_PATH, PEER_SECURE } = config;
      const proto = PEER_SECURE ? 'wss' : 'ws';
      const path  = PEER_PATH.endsWith('/') ? PEER_PATH : `${PEER_PATH}/`;
      const wsUrl = `${proto}://${PEER_HOST}:${PEER_PORT}${path}peerjs?key=peerjs&id=${encodeURIComponent(screenPeerId)}&token=${uuid()}`;

      this.screenPeerWs = new WebSocket(wsUrl);
      const timer = setTimeout(() => reject(new Error(`[Bot ${this.roomId}] Screen PeerJS WS timed out`)), 10_000);

      this.screenPeerWs.on('open', () => {
        this.screenHbTimer = setInterval(() => {
          if (this.screenPeerWs?.readyState === WebSocket.OPEN) {
            this.screenPeerWs.send(JSON.stringify({ type: 'HEARTBEAT' }));
          } else {
            clearInterval(this.screenHbTimer!); this.screenHbTimer = null;
          }
        }, 5_000);
      });

      this.screenPeerWs.on('message', async (raw: WebSocket.RawData) => {
        let msg: { type: string; src: string; dst: string; payload: Record<string, unknown> };
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        switch (msg.type) {
          case 'OPEN':
            clearTimeout(timer);
            console.log(`[ScreenPeerWS ${this.roomId}] Open ✓ - screen peer: ${screenPeerId}`);
            resolve();
            break;
          case 'ANSWER':    await this.onAVAnswer(msg.src, msg.payload);    break;
          case 'CANDIDATE': await this.onAVCandidate(msg.src, msg.payload); break;
          case 'LEAVE':
          case 'EXPIRE':    this.closeAVPeer(msg.src); break;
          case 'ID-TAKEN':
            clearTimeout(timer);
            reject(new Error(`[Bot ${this.roomId}] Screen peer ID already taken: ${screenPeerId}`));
            break;
          case 'ERROR':
            console.error(`[ScreenPeerWS ${this.roomId}] Server error:`, msg.payload);
            break;
        }
      });

      this.screenPeerWs.on('error', (err) => { clearTimeout(timer); reject(err); });
      this.screenPeerWs.on('close', () => {
        if (this.screenHbTimer) { clearInterval(this.screenHbTimer); this.screenHbTimer = null; }
      });
    });
  }

  private sendScreenPeer(type: string, dst: string, payload: Record<string, unknown>): void {
    if (this.screenPeerWs?.readyState !== WebSocket.OPEN) return;
    this.screenPeerWs.send(JSON.stringify({ type, src: this.screenPeerId, dst, payload }));
  }

  // peer connections: one PC, two transceivers

  private makeAVPc(remotePeerId: string, connectionId: string): AVPeerConn {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    // Both tracks on the same PC - the browser's RTCP SR mechanism syncs them.
    const audioTrack       = new MediaStreamTrack({ kind: 'audio' });
    const audioTransceiver = pc.addTransceiver(audioTrack, { direction: 'sendonly' });
    const videoTrack       = new MediaStreamTrack({ kind: 'video' });
    const videoTransceiver = pc.addTransceiver(videoTrack, { direction: 'sendonly' });

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        setTimeout(() => {
          this.sendScreenPeer('CANDIDATE', remotePeerId, {
            candidate: candidate.toJSON(), connectionId, type: 'media',
          });
        }, 100);
      }
    };

    pc.addEventListener('connectionstatechange', () => {
      const state = pc.connectionState;
      console.log(`[AVPC ${this.roomId}→${remotePeerId}] state: ${state}`);
      if (state === 'failed' || state === 'closed') {
        this.closeAVPeer(remotePeerId);
      }
    });

    const conn: AVPeerConn = {
      pc, audioTrack, audioTransceiver, videoTrack, videoTransceiver, connectionId,
      audioSsrc:      Math.floor(Math.random() * 0xFFFFFFFF),
      audioSeq:       Math.floor(Math.random() * 0xFFFF),
      audioTimestamp: Math.floor(Math.random() * 0xFFFFFFFF),
      videoSsrc:      Math.floor(Math.random() * 0xFFFFFFFF),
      videoSeq:       Math.floor(Math.random() * 0xFFFF),
      videoTimestamp: Math.floor(Math.random() * 0xFFFFFFFF),
    };
    this.avConns.set(remotePeerId, conn);
    return conn;
  }

  private async callFrontendScreenPeer(frontendScreenPeerId: string, alias: string): Promise<void> {
    if (this.destroyed) return;
    if (this.avConns.has(frontendScreenPeerId)) return;

    const connectionId = `screen-${uuid()}`;
    console.log(`[Bot ${this.roomId}] → Calling frontend screen peer ${frontendScreenPeerId} (${alias}) with audio+video`);
    const conn = this.makeAVPc(frontendScreenPeerId, connectionId);

    try {
      const offer = await conn.pc.createOffer();
      await conn.pc.setLocalDescription(offer);
      this.sendScreenPeer('OFFER', frontendScreenPeerId, {
        sdp: { sdp: offer.sdp, type: offer.type },
        connectionId,
        type: 'media',
        browser: 'node-bot',
        metadata: { connectionId },
      });
    } catch (err) {
      console.error(`[Bot ${this.roomId}] Failed to create AV offer for ${frontendScreenPeerId}:`, err);
      this.closeAVPeer(frontendScreenPeerId);
    }
  }

  private async onAVAnswer(remotePeerId: string, payload: Record<string, unknown>): Promise<void> {
    const conn = this.avConns.get(remotePeerId);
    if (!conn) return;
    const sdpObj  = payload.sdp as { sdp: string; type: string } | string;
    const sdpStr  = typeof sdpObj === 'string' ? sdpObj : sdpObj.sdp;
    const sdpType = typeof sdpObj === 'string' ? payload.type as string : sdpObj.type;
    await conn.pc.setRemoteDescription(new RTCSessionDescription(sdpStr, sdpType as 'offer' | 'answer'));
    await this.drainAVIceBuf(remotePeerId, conn.pc);
  }

  private async onAVCandidate(remotePeerId: string, payload: Record<string, unknown>): Promise<void> {
    const raw = payload.candidate as IceEntry | null;
    if (!raw) return;
    const conn = this.avConns.get(remotePeerId);
    if (!conn?.pc.remoteDescription) {
      const buf = this.avIceBuf.get(remotePeerId) ?? [];
      buf.push(raw);
      this.avIceBuf.set(remotePeerId, buf);
      return;
    }
    try { await conn.pc.addIceCandidate(new RTCIceCandidate(raw)); } catch {}
  }

  private async drainAVIceBuf(peerId: string, pc: RTCPeerConnection): Promise<void> {
    const buf = this.avIceBuf.get(peerId) ?? [];
    this.avIceBuf.delete(peerId);
    for (const cand of buf) {
      try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch {}
    }
  }

  private closeAVPeer(peerId: string): void {
    const conn = this.avConns.get(peerId);
    if (!conn) return;
    try { conn.pc.close(); } catch {}
    this.avConns.delete(peerId);
    this.avIceBuf.delete(peerId);
    console.log(`[Bot ${this.roomId}] Closed AV peer: ${peerId}`);
    this.checkAutoLeave();
  }

  private sendOpusFrameAV(conn: AVPeerConn, frame: OpusFrame): void {
    if (conn.pc.connectionState !== 'connected') return;
    conn.audioSeq       = (conn.audioSeq + 1) & 0xFFFF;
    conn.audioTimestamp = (conn.audioTimestamp + RTP_TIMESTAMP_STEP) >>> 0;
    const header = Buffer.alloc(12);
    header[0] = 0x80;
    header[1] = OPUS_PAYLOAD_TYPE & 0x7F;
    header.writeUInt16BE(conn.audioSeq, 2);
    header.writeUInt32BE(conn.audioTimestamp, 4);
    header.writeUInt32BE(conn.audioSsrc, 8);
    try { conn.audioTrack.writeRtp(Buffer.concat([header, frame.data])); } catch {}
  }

  private sendVP8Frame(conn: AVPeerConn, frameData: Buffer): void {
    if (conn.pc.connectionState !== 'connected') return;
    conn.videoTimestamp = (conn.videoTimestamp + VP8_TIMESTAMP_STEP) >>> 0;
    let offset = 0;
    while (offset < frameData.length) {
      const isFirst = offset === 0;
      const chunk   = frameData.subarray(offset, offset + VP8_MAX_RTP_PAYLOAD);
      const isLast  = offset + chunk.length >= frameData.length;
      conn.videoSeq = (conn.videoSeq + 1) & 0xFFFF;
      const header = Buffer.alloc(12);
      header[0] = 0x80;
      header[1] = (isLast ? 0x80 : 0x00) | (VP8_PAYLOAD_TYPE & 0x7F);
      header.writeUInt16BE(conn.videoSeq, 2);
      header.writeUInt32BE(conn.videoTimestamp, 4);
      header.writeUInt32BE(conn.videoSsrc, 8);
      const desc = Buffer.alloc(1);
      desc[0] = isFirst ? 0x10 : 0x00;
      try { conn.videoTrack.writeRtp(Buffer.concat([header, desc, chunk])); } catch {}
      offset += chunk.length;
    }
  }
}