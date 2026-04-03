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

interface PeerConn {
  pc:           RTCPeerConnection;
  track:        MediaStreamTrack;
  transceiver:  RTCRtpTransceiver;
  connectionId: string;
  ssrc:         number;
  seq:          number;
  timestamp:    number;
}

interface VideoPeerConn {
  pc:           RTCPeerConnection;
  track:        MediaStreamTrack;
  transceiver:  RTCRtpTransceiver;
  connectionId: string;
  ssrc:         number;
  seq:          number;
  timestamp:    number;
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

  // Audio pipeline (always present)
  private pipeline:   AudioPipeline;
  private youtubeUrl: string;
  private conns       = new Map<string, PeerConn>();
  private iceBuf      = new Map<string, IceEntry[]>();
  private hbTimer:    NodeJS.Timeout | null = null;
  private destroyed   = false;
  private frameQueue: OpusFrame[] = [];
  private isConnected = false;

  // Video screenshare mode (optional)
  private videoMode:      boolean;
  private avPipeline:     AVPipeline | null = null;
  private screenPeerId:   string | null = null;
  private screenConnected = false;
  private screenPeerWs:  WebSocket | null = null;
  private videoConns     = new Map<string, VideoPeerConn>();
  private videoIceBuf    = new Map<string, IceEntry[]>();
  private screenHbTimer: NodeJS.Timeout | null = null;

  readonly roomId: string;

  constructor(roomId: string, youtubeUrl: string, private readonly token: string, videoMode = false) {
    this.roomId     = roomId;
    this.youtubeUrl = youtubeUrl;
    this.videoMode  = videoMode;
    this.pipeline   = new AudioPipeline(youtubeUrl);
    if (videoMode) this.avPipeline = new AVPipeline(youtubeUrl);
  }

  // ── Pipeline listeners ────────────────────────────────────────────────────

  private readonly onFrame = (frame: OpusFrame) => {
    if (this.isConnected) {
      for (const conn of this.conns.values()) this.sendOpusFrame(conn, frame);
    } else {
      this.frameQueue.push(frame);
    }
  };

  private readonly onVideoFrame = (frameData: Buffer) => {
    for (const conn of this.videoConns.values()) this.sendVP8Frame(conn, frameData);
  };

  private readonly onEnded = (code: number | null) => {
    console.log(`[Bot ${this.roomId}] Pipeline ended (exit ${code})`);
    this.emitToRoom('musicman:track-ended', { roomId: this.roomId });
  };

  private readonly onPipelineError = (e: Error) =>
    console.error(`[Bot ${this.roomId}] Pipeline error:`, e);

  private wirePipeline(): void {
    this.pipeline.on('frame', this.onFrame);
    this.pipeline.on('ended', this.onEnded);
    this.pipeline.on('error', this.onPipelineError);
  }

  private unwirePipeline(): void {
    this.pipeline.removeListener('frame', this.onFrame);
    this.pipeline.removeListener('ended', this.onEnded);
    this.pipeline.removeListener('error', this.onPipelineError);
  }

  private wireAVPipeline(): void {
    this.avPipeline!.on('audioFrame', this.onFrame);
    this.avPipeline!.on('videoFrame', this.onVideoFrame);
    this.avPipeline!.on('ended',      this.onEnded);
    this.avPipeline!.on('error',      this.onPipelineError);
  }

  private unwireAVPipeline(): void {
    this.avPipeline!.removeListener('audioFrame', this.onFrame);
    this.avPipeline!.removeListener('videoFrame', this.onVideoFrame);
    this.avPipeline!.removeListener('ended',      this.onEnded);
    this.avPipeline!.removeListener('error',      this.onPipelineError);
  }

  private get activePipeline(): AudioPipeline | AVPipeline {
    return (this.videoMode && this.avPipeline) ? this.avPipeline : this.pipeline;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

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
      for (const peerId of [...this.videoConns.keys()]) this.closeVideoPeer(peerId);
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

  // ── Playback controls ─────────────────────────────────────────────────────

  changeTrack(url: string): void {
    if (this.destroyed) return;
    console.log(`[Bot ${this.roomId}] changeTrack → ${url}`);
    this.youtubeUrl = url;

    if (this.videoMode && this.avPipeline) {
      this.unwireAVPipeline();
      this.avPipeline.stop();
      this.frameQueue = [];
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

  // ── Signaling ─────────────────────────────────────────────────────────────

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
            console.log(`[Bot ${this.roomId}] Video screenshare started — screen peer: ${screenPeerId}`);
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

      // Server sends existing screen peers in the room after we emit screenshare-started.
      this.socket.on('room-screen-peers', ({ peers }: { peers: Array<{ screenPeerId: string; alias: string }> }) => {
        console.log(`[Bot ${this.roomId}] room-screen-peers: ${peers.length} peer(s)`);
        for (const { screenPeerId, alias } of peers) {
          this.callFrontendScreenPeer(screenPeerId, alias);
        }
      });

      // A new user joined while we are already sharing — call their screen peer.
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

  // ── Audio PeerJS WS ───────────────────────────────────────────────────────

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
          case 'OFFER':    await this.onOffer(msg.src, msg.payload);    break;
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

  // ── Audio peer connections — identical to original working version ─────────

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

    // Diagnostic: log key SDP lines to verify PT, direction, and SSRC
    const sdpLines = (answer.sdp ?? '').split(/\r?\n/);
    const relevant = sdpLines.filter(l =>
      l.startsWith('a=rtpmap') || l.startsWith('a=sendonly') ||
      l.startsWith('a=recvonly') || l.startsWith('a=sendrecv') ||
      l.startsWith('a=inactive') || l.startsWith('a=ssrc')
    );
    console.log(`[Bot ${this.roomId}] answer SDP for ${remotePeerId}:`, relevant);

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
      // Log first 3 successful sends so we know writeRtp isn't silently failing
      if (this._rtpLogCount < 3) {
        this._rtpLogCount++;
        console.log(`[Bot ${this.roomId}] writeRtp ok #${this._rtpLogCount} — ssrc: ${conn.ssrc}, seq: ${conn.seq}, pt: ${OPUS_PAYLOAD_TYPE}, bytes: ${pkt.length}`);
      }
    } catch (e) {
      // Log errors — previously swallowed silently
      if (this._rtpLogCount < 3) {
        this._rtpLogCount++;
        console.error(`[Bot ${this.roomId}] writeRtp ERROR #${this._rtpLogCount}:`, e);
      }
    }
  }

  // ── Screen PeerJS WS ─────────────────────────────────────────────────────

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
          // Bot is the CALLER — it sends OFFERs and receives ANSWERs.
          case 'OPEN':
            clearTimeout(timer);
            console.log(`[ScreenPeerWS ${this.roomId}] Open ✓ — screen peer: ${screenPeerId}`);
            resolve();
            break;
          case 'ANSWER':    await this.onScreenAnswer(msg.src, msg.payload); break;
          case 'CANDIDATE': await this.onScreenCandidate(msg.src, msg.payload); break;
          case 'LEAVE':
          case 'EXPIRE':    this.closeVideoPeer(msg.src); break;
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

  // ── Video peer connections ────────────────────────────────────────────────

  // ── Bot-as-caller: bot sends OFFERs to frontend screen peers ────────────
  // The bot owns the video stream so it must be the PeerJS caller.
  // The frontend's screen peer answers and the stream event fires on the viewer.

  private makeVideoPc(remotePeerId: string, connectionId: string): VideoPeerConn {
    const pc    = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const track = new MediaStreamTrack({ kind: 'video' });
    // Pre-add sendonly transceiver — we are the caller with a video track to send.
    const transceiver = pc.addTransceiver(track, { direction: 'sendonly' });

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
      console.log(`[ScreenPC ${this.roomId}→${remotePeerId}] state: ${state}`);
      if (state === 'connected') {
        this.screenConnected = true;
      }
      if (state === 'failed' || state === 'closed') {
        this.closeVideoPeer(remotePeerId);
        this.screenConnected = this.videoConns.size > 0;
      }
    });

    const conn: VideoPeerConn = {
      pc, track, transceiver, connectionId,
      ssrc:      Math.floor(Math.random() * 0xFFFFFFFF),
      seq:       Math.floor(Math.random() * 0xFFFF),
      timestamp: Math.floor(Math.random() * 0xFFFFFFFF),
    };
    this.videoConns.set(remotePeerId, conn);
    return conn;
  }

  // Called when the signaling server tells us a frontend screen peer exists.
  // The bot creates the offer so the frontend receives an incoming call and
  // the stream event fires on the viewer side when we push VP8 frames.
  private async callFrontendScreenPeer(frontendScreenPeerId: string, alias: string): Promise<void> {
    if (this.destroyed) return;
    if (this.videoConns.has(frontendScreenPeerId)) return; // already connected

    const connectionId = `screen-${uuid()}`;
    console.log(`[Bot ${this.roomId}] → Calling frontend screen peer ${frontendScreenPeerId} (${alias})`);
    const conn = this.makeVideoPc(frontendScreenPeerId, connectionId);

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
      console.error(`[Bot ${this.roomId}] Failed to create screen offer for ${frontendScreenPeerId}:`, err);
      this.closeVideoPeer(frontendScreenPeerId);
    }
  }

  private async onScreenAnswer(remotePeerId: string, payload: Record<string, unknown>): Promise<void> {
    const conn = this.videoConns.get(remotePeerId);
    if (!conn) return;
    const sdpObj  = payload.sdp as { sdp: string; type: string } | string;
    const sdpStr  = typeof sdpObj === 'string' ? sdpObj : sdpObj.sdp;
    const sdpType = typeof sdpObj === 'string' ? payload.type as string : sdpObj.type;
    await conn.pc.setRemoteDescription(new RTCSessionDescription(sdpStr, sdpType as 'offer' | 'answer'));
    await this.drainVideoIceBuf(remotePeerId, conn.pc);
  }

  private async onScreenCandidate(remotePeerId: string, payload: Record<string, unknown>): Promise<void> {
    const raw = payload.candidate as IceEntry | null;
    if (!raw) return;
    const conn = this.videoConns.get(remotePeerId);
    if (!conn?.pc.remoteDescription) {
      const buf = this.videoIceBuf.get(remotePeerId) ?? [];
      buf.push(raw);
      this.videoIceBuf.set(remotePeerId, buf);
      return;
    }
    try { await conn.pc.addIceCandidate(new RTCIceCandidate(raw)); } catch {}
  }

  private async drainVideoIceBuf(peerId: string, pc: RTCPeerConnection): Promise<void> {
    const buf = this.videoIceBuf.get(peerId) ?? [];
    this.videoIceBuf.delete(peerId);
    for (const cand of buf) {
      try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch {}
    }
  }

  private closeVideoPeer(peerId: string): void {
    const conn = this.videoConns.get(peerId);
    if (!conn) return;
    try { conn.pc.close(); } catch {}
    this.videoConns.delete(peerId);
    this.videoIceBuf.delete(peerId);
  }

  private sendVP8Frame(conn: VideoPeerConn, frameData: Buffer): void {
    if (conn.pc.connectionState !== 'connected') return;
    conn.timestamp = (conn.timestamp + VP8_TIMESTAMP_STEP) >>> 0;
    let offset = 0;
    while (offset < frameData.length) {
      const isFirst = offset === 0;
      const chunk   = frameData.subarray(offset, offset + VP8_MAX_RTP_PAYLOAD);
      const isLast  = offset + chunk.length >= frameData.length;
      conn.seq = (conn.seq + 1) & 0xFFFF;
      const header = Buffer.alloc(12);
      header[0] = 0x80;
      header[1] = (isLast ? 0x80 : 0x00) | (VP8_PAYLOAD_TYPE & 0x7F);
      header.writeUInt16BE(conn.seq, 2);
      header.writeUInt32BE(conn.timestamp, 4);
      header.writeUInt32BE(conn.ssrc, 8);
      const desc = Buffer.alloc(1);
      desc[0] = isFirst ? 0x10 : 0x00;
      try { conn.track.writeRtp(Buffer.concat([header, desc, chunk])); } catch {}
      offset += chunk.length;
    }
  }
}