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

type AllUsersPayload      = Array<{ peerId: string; alias: string; userId: string }>;
type UserConnectedPayload = { peerId: string; alias: string };

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'turn:10.10.10.10:3478', username: 'talk', credential: 'talkpass' },
];

export class BotInstance {
  private socket:   Socket | null = null;
  private peerWs:   WebSocket | null = null;
  private myPeerId: string | null = null;

  private pipeline:   AudioPipeline;
  private youtubeUrl: string;
  private conns       = new Map<string, PeerConn>();
  private iceBuf      = new Map<string, { candidate: string; sdpMid?: string; sdpMLineIndex?: number }[]>();
  private hbTimer:    NodeJS.Timeout | null = null;
  private destroyed   = false;

  private frameQueue:  OpusFrame[] = [];
  private isConnected  = false;

  readonly roomId: string;

  constructor(roomId: string, youtubeUrl: string, private readonly token: string) {
    this.roomId     = roomId;
    this.youtubeUrl = youtubeUrl;
    this.pipeline   = new AudioPipeline(youtubeUrl);
  }

  // ── Pipeline listeners ────────────────────────────────────────────────────

  private readonly onFrame = (frame: OpusFrame) => {
    if (this.isConnected) {
      for (const conn of this.conns.values()) {
        this.sendOpusFrame(conn, frame);
      }
    } else {
      this.frameQueue.push(frame);
    }
  };

  private readonly onEnded = (code: number | null) => {
    console.log(`[Bot ${this.roomId}] Audio pipeline ended (exit ${code})`);
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

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.wirePipeline();
    await this.connectSignaling();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    console.log(`[Bot ${this.roomId}] Destroying`);

    this.unwirePipeline();
    this.pipeline.stop();
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

  /**
   * Swap the currently streaming track without tearing down WebRTC or signaling.
   * Existing peer connections continue uninterrupted — they will hear a brief
   * silence while the new yt-dlp/ffmpeg pipeline starts.
   */
  changeTrack(url: string): void {
    if (this.destroyed) return;
    console.log(`[Bot ${this.roomId}] changeTrack → ${url}`);
    this.unwirePipeline();
    this.pipeline.stop();
    this.frameQueue  = [];
    this.youtubeUrl  = url;
    this.pipeline    = new AudioPipeline(url);
    this.wirePipeline();
    this.pipeline.start();
    this.emitToRoom('musicman:track-changed', {
      roomId:     this.roomId,
      youtubeUrl: url,
    });
  }

  pause(): void {
    this.pipeline.pause();
    this.emitToRoom('musicman:state-changed', {
      roomId:  this.roomId,
      playing: this.pipeline.running,
      paused:  true,
    });
  }

  resume(): void {
    this.pipeline.resume();
    this.emitToRoom('musicman:state-changed', {
      roomId:  this.roomId,
      playing: this.pipeline.running,
      paused:  false,
    });
  }

  seek(ms: number): void { this.pipeline.seek(ms); }

  getStatus(): { playing: boolean; paused: boolean; positionMs: number; youtubeUrl: string } {
    return {
      playing:    this.pipeline.running,
      paused:     this.pipeline.isPaused,
      positionMs: this.pipeline.positionMs,
      youtubeUrl: this.youtubeUrl,
    };
  }

  private emitToRoom(event: string, data: Record<string, unknown>): void {
    if (this.socket?.connected) {
      this.socket.emit(event, data);
    }
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
          this.pipeline.start();
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      this.socket.on('all-users', (users: AllUsersPayload) => {
        console.log(
          `[Bot ${this.roomId}] all-users (${users.length}):`,
          users.map((u) => `${u.alias}/${u.peerId}`),
        );
        // Don't call peers - let them call us
      });

      this.socket.on('user-connected', ({ peerId, alias }: UserConnectedPayload) => {
        console.log(`[Bot ${this.roomId}] user-connected: ${alias} (${peerId})`);
        // Don't call peers - let them call us
      });

      this.socket.on('user-disconnected', (peerId: string) => {
        console.log(`[Bot ${this.roomId}] user-disconnected: ${peerId}`);
        this.closePeer(peerId);
      });

      this.socket.on('room-closed', () => {
        console.log(`[Bot ${this.roomId}] room-closed`);
        this.destroy();
      });

      this.socket.on('join-error', ({ message: msg }: { message: string }) =>
        console.error(`[Bot ${this.roomId}] join-error: ${msg}`));

      this.socket.on('connect_error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

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
        let msg: {
          type:    string;
          src:     string;
          dst:     string;
          payload: Record<string, unknown>;
        };
        try { msg = JSON.parse(raw.toString()); } catch { return; }

        switch (msg.type) {
          case 'OPEN':
            clearTimeout(timer);
            console.log(`[PeerWS ${this.roomId}] Open ✓`);
            resolve();
            break;
          case 'OFFER':     await this.onOffer(msg.src, msg.payload);     break;
          case 'ANSWER':    await this.onAnswer(msg.src, msg.payload);    break;
          case 'CANDIDATE': await this.onCandidate(msg.src, msg.payload); break;
          case 'LEAVE':
          case 'EXPIRE':    this.closePeer(msg.src);                      break;
          case 'ERROR':
            console.error(`[PeerWS ${this.roomId}] Server error:`, msg.payload);
            break;
          case 'ID-TAKEN':
            reject(new Error(`[Bot ${this.roomId}] Peer ID already taken: ${peerId}`));
            break;
        }
      });

      this.peerWs.on('error', (err) => { clearTimeout(timer); reject(err); });
      this.peerWs.on('close', () => {
        if (this.hbTimer) { clearInterval(this.hbTimer); this.hbTimer = null; }
        if (!this.destroyed) {
          console.warn(`[PeerWS ${this.roomId}] WebSocket closed unexpectedly`);
        }
      });
    });
  }

  private sendPeer(type: string, dst: string, payload: Record<string, unknown>): void {
    if (this.peerWs?.readyState !== WebSocket.OPEN) return;
    this.peerWs.send(JSON.stringify({ type, src: this.myPeerId, dst, payload }));
  }

  private makePc(remotePeerId: string, connectionId: string): PeerConn {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    const track       = new MediaStreamTrack({ kind: 'audio' });
    const transceiver = pc.addTransceiver(track, { direction: 'sendonly' });

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        setTimeout(() => {
          this.sendPeer('CANDIDATE', remotePeerId, {
            candidate:    candidate.toJSON(),
            connectionId,
            type:         'media',
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
          for (const frame of this.frameQueue) {
            this.sendOpusFrame(conn, frame);
          }
          this.frameQueue = [];
        }
      }

      if (state === 'failed' || state === 'closed') {
        this.isConnected = false;
        this.closePeer(remotePeerId);
      }
    });

    const conn: PeerConn = {
      pc,
      track,
      transceiver,
      connectionId,
      ssrc:      Math.floor(Math.random() * 0xFFFFFFFF),
      seq:       Math.floor(Math.random() * 0xFFFF),
      timestamp: Math.floor(Math.random() * 0xFFFFFFFF),
    };

    this.conns.set(remotePeerId, conn);
    return conn;
  }

  private async callPeer(remotePeerId: string): Promise<void> {
    if (this.conns.has(remotePeerId) || this.destroyed) return;

    const connectionId = uuid().replace(/-/g, '').slice(0, 16);
    console.log(`[Bot ${this.roomId}] → Calling ${remotePeerId} (conn: ${connectionId})`);

    const conn  = this.makePc(remotePeerId, connectionId);
    const offer = await conn.pc.createOffer();
    await conn.pc.setLocalDescription(offer);

    this.sendPeer('OFFER', remotePeerId, {
      sdp:          { sdp: offer.sdp, type: offer.type },
      connectionId,
      metadata:     null,
      browser:      'node-bot',
    });
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

    await conn.pc.setRemoteDescription(
      new RTCSessionDescription(sdpStr, sdpType as 'offer' | 'answer'),
    );
    await this.drainIceBuf(remotePeerId, conn.pc);

    const answer = await conn.pc.createAnswer();
    await conn.pc.setLocalDescription(answer);

    this.sendPeer('ANSWER', remotePeerId, {
      sdp:          { sdp: answer.sdp, type: answer.type },
      connectionId,
      browser:      'node-bot',
    });
  }

  private async onAnswer(remotePeerId: string, payload: Record<string, unknown>): Promise<void> {
    const conn = this.conns.get(remotePeerId);
    if (!conn) return;

    const sdpObj  = payload.sdp as { sdp: string; type: string } | string;
    const sdpStr  = typeof sdpObj === 'string' ? sdpObj : sdpObj.sdp;
    const sdpType = typeof sdpObj === 'string' ? payload.type as string : sdpObj.type;

    await conn.pc.setRemoteDescription(
      new RTCSessionDescription(sdpStr, sdpType as 'offer' | 'answer'),
    );
    await this.drainIceBuf(remotePeerId, conn.pc);
  }

  private async onCandidate(remotePeerId: string, payload: Record<string, unknown>): Promise<void> {
    const raw = payload.candidate as { candidate: string; sdpMid?: string; sdpMLineIndex?: number } | null;
    if (!raw) return;

    const conn = this.conns.get(remotePeerId);

    if (!conn?.pc.remoteDescription) {
      const buf = this.iceBuf.get(remotePeerId) ?? [];
      buf.push(raw);
      this.iceBuf.set(remotePeerId, buf);
      return;
    }

    try {
      await conn.pc.addIceCandidate(new RTCIceCandidate(raw));
    } catch (err) {
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
    try { conn.pc.close(); } catch { /* already closed */ }
    this.conns.delete(peerId);
    this.iceBuf.delete(peerId);
    console.log(`[Bot ${this.roomId}] Closed peer connection: ${peerId}`);
  }

  private sendOpusFrame(conn: PeerConn, frame: OpusFrame): void {
    if (conn.pc.connectionState !== 'connected') return;

    conn.seq       = (conn.seq + 1) & 0xFFFF;
    conn.timestamp = (conn.timestamp + RTP_TIMESTAMP_STEP) >>> 0;

    const header = Buffer.alloc(12);
    header[0]  = 0x80;
    header[1]  = OPUS_PAYLOAD_TYPE & 0x7F;
    header.writeUInt16BE(conn.seq,       2);
    header.writeUInt32BE(conn.timestamp, 4);
    header.writeUInt32BE(conn.ssrc,      8);

    const rtpPacket = Buffer.concat([header, frame.data]);

    try {
      conn.track.writeRtp(rtpPacket);
    } catch {
      // Track may be stopped - silently skip
    }
  }
}
