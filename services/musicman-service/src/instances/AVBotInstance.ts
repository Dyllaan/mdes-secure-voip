import WebSocket from 'ws';
import { v4 as uuid } from 'uuid';
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  MediaStreamTrack,
  useVP8,
  useOPUS,
  type RTCRtpTransceiver,
} from 'werift';
import { type OpusFrame } from '../pipelines/AudioPipeline';
import { AVPipeline, VP8_PAYLOAD_TYPE, VP8_TIMESTAMP_STEP } from '../pipelines/AVPipeline';
import {
  BotInstance,
  OPUS_PAYLOAD_TYPE,
  type IceEntry,
  type AllUsersPayload,
  type TurnCredentials,
} from './BotInstance';
import { config } from '../config';

const VP8_MAX_RTP_PAYLOAD = 1_200;

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

export class AVBotInstance extends BotInstance {
  private avPipeline:    AVPipeline;
  private screenPeerId:  string | null = null;
  private screenPeerWs:  WebSocket | null = null;
  private avConns        = new Map<string, AVPeerConn>();
  private avIceBuf       = new Map<string, IceEntry[]>();
  private screenHbTimer: NodeJS.Timeout | null = null;
  override readonly videoMode: boolean = true;
  
  private OPUS_RTP_TIMESTAMP_STEP = 960; // 48000 * 0.02

  constructor(
    roomId: string,
    url: string,
    token: string,
    turnCredentials: TurnCredentials,
  ) {
    super(roomId, url, token, turnCredentials);
    this.avPipeline = new AVPipeline(url);
  }

  protected override readonly onAudioFrame = (frame: OpusFrame) => {
    for (const conn of this.avConns.values()) this.sendOpusFrameAV(conn, frame);
  };

  private readonly onVideoFrame = (frameData: Buffer) => {
    for (const conn of this.avConns.values()) this.sendVP8Frame(conn, frameData);
  };

  private wireAVPipeline(): void {
    this.avPipeline.on('audioFrame', this.onAudioFrame);
    this.avPipeline.on('videoFrame', this.onVideoFrame);
    this.avPipeline.on('ended',      this.onEnded);
    this.avPipeline.on('error',      this.onPipelineError);
  }

  private unwireAVPipeline(): void {
    this.avPipeline.removeListener('audioFrame', this.onAudioFrame);
    this.avPipeline.removeListener('videoFrame', this.onVideoFrame);
    this.avPipeline.removeListener('ended',      this.onEnded);
    this.avPipeline.removeListener('error',      this.onPipelineError);
  }

  override async start(): Promise<void> {
    this.wireAVPipeline();
    await this.connectSignaling();
  }

  override destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    console.log(`[AVBot ${this.roomId}] Destroying`);

    this.unwireAVPipeline();
    this.avPipeline.stop();

    if (this.screenHbTimer) { clearInterval(this.screenHbTimer); this.screenHbTimer = null; }
    for (const peerId of [...this.avConns.keys()]) this.closeAVPeer(peerId);

    if (this.socket?.connected) {
      this.socket.emit('screenshare-stopped');
      this.socket.emit('leave-room', { roomId: this.roomId });
      this.socket.disconnect();
    }
    this.screenPeerWs?.close();
    this.screenPeerWs = null;
    this.peerWs?.close();
  }

  override changeTrack(url: string): void {
    if (this.destroyed) return;
    console.log(`[AVBot ${this.roomId}] changeTrack -> ${url}`);
    this.url = url;

    this.unwireAVPipeline();
    this.avPipeline.stop();
    this.avPipeline = new AVPipeline(url);
    this.wireAVPipeline();
    this.avPipeline.start();

    this.emitToRoom('musicman:track-changed', { roomId: this.roomId, url: url });
  }

  override pause(): void {
    this.avPipeline.pause();
    this.emitToRoom('musicman:state-changed', {
      roomId: this.roomId, playing: this.avPipeline.running, paused: true,
    });
  }

  override resume(): void {
    this.avPipeline.resume();
    this.emitToRoom('musicman:state-changed', {
      roomId: this.roomId, playing: this.avPipeline.running, paused: false,
    });
  }

  override seek(ms: number): void { this.avPipeline.seek(ms); }

  override getStatus() {
    return {
      ...super.getStatus(),
      playing:      this.avPipeline.running,
      paused:       this.avPipeline.isPaused,
      positionMs:   this.avPipeline.positionMs,
      videoMode:    true,
      screenPeerId: this.screenPeerId,
    };
  }

  protected override checkAutoLeave(): void {
    if (this.avConns.size === 0) {
      console.log(`[AVBot ${this.roomId}] No peers connected, triggering auto-leave`);
      this.onAutoLeave?.();
    }
  }

  protected override async onAllUsers(users: AllUsersPayload): Promise<void> {
    console.log(`[AVBot ${this.roomId}] all-users (${users.length}):`, users.map(u => u.alias));
    const screenPeerId = await this.requestScreenPeerId();
    this.screenPeerId = screenPeerId;
    await this.connectScreenPeerWs(screenPeerId);
    this.avPipeline.start();
    this.socket!.emit('screenshare-started', { screenPeerId });
    console.log(`[AVBot ${this.roomId}] AV stream started - screen peer: ${screenPeerId}`);
  }

  protected override connectSignaling(): Promise<void> {
    return new Promise((resolve, reject) => {
      super.connectSignaling().then(resolve).catch(reject);

      // Attach AV-specific socket events after super wires up the socket.
      // connectSignaling is synchronous up to the Promise executor so socket is assigned.
      queueMicrotask(() => {
        if (!this.socket) return;

        this.socket.on('room-screen-peers', ({ peers }: { peers: Array<{ screenPeerId: string; alias: string }> }) => {
          console.log(`[AVBot ${this.roomId}] room-screen-peers: ${peers.length} peer(s)`);
          for (const { screenPeerId, alias } of peers) {
            this.callFrontendScreenPeer(screenPeerId, alias);
          }
        });

        this.socket.on('new-screen-peer', ({ screenPeerId, alias }: { screenPeerId: string; alias: string }) => {
          console.log(`[AVBot ${this.roomId}] new-screen-peer: ${alias} (${screenPeerId})`);
          this.callFrontendScreenPeer(screenPeerId, alias);
        });

        this.socket.on('peer-screenshare-stopped', ({ screenPeerId }: { screenPeerId?: string }) => {
          if (screenPeerId) this.closeAVPeer(screenPeerId);
        });
      });
    });
  }

  private requestScreenPeerId(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`[AVBot ${this.roomId}] screen peer ID request timed out`)),
        10_000,
      );
      this.socket!.once('screen-peer-assigned', (payload: Record<string, string>) => {
        clearTimeout(timeout);
        const id = payload['peerId'];
        if (!id) return reject(new Error(`[AVBot ${this.roomId}] screen-peer-assigned missing peerId`));
        resolve(id);
      });
      this.socket!.emit('request-screen-peer-id');
    });
  }

  private connectScreenPeerWs(screenPeerId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const { PEER_HOST, PEER_PORT, PEER_PATH, PEER_SECURE } = config;
      const proto = PEER_SECURE ? 'wss' : 'ws';
      const path  = PEER_PATH.endsWith('/') ? PEER_PATH : `${PEER_PATH}/`;
      const wsUrl = `${proto}://${PEER_HOST}:${PEER_PORT}${path}peerjs?key=peerjs&id=${encodeURIComponent(screenPeerId)}&token=${uuid()}`;

      this.screenPeerWs = new WebSocket(wsUrl);
      const timer = setTimeout(() => reject(new Error(`[AVBot ${this.roomId}] Screen PeerJS WS timed out`)), 10_000);

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
            reject(new Error(`[AVBot ${this.roomId}] Screen peer ID already taken: ${screenPeerId}`));
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

  private makeAVPc(remotePeerId: string, connectionId: string): AVPeerConn {
    const pc = new RTCPeerConnection({
      iceServers: this.buildIceServers(),
      codecs: {
        video: [useVP8({ payloadType: VP8_PAYLOAD_TYPE })],
        audio: [useOPUS({ payloadType: OPUS_PAYLOAD_TYPE })],
      },
    });

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
      console.log(`[AVPC ${this.roomId}->${remotePeerId}] state: ${state}`);
      if (state === 'failed' || state === 'closed') this.closeAVPeer(remotePeerId);
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
    const existing = this.avConns.get(frontendScreenPeerId);
    if (existing) {
      try { existing.pc.close(); } catch {}
      this.avConns.delete(frontendScreenPeerId);
      this.avIceBuf.delete(frontendScreenPeerId);
      console.log(`[AVBot ${this.roomId}] Replaced stale AV peer: ${frontendScreenPeerId}`);
    }
    if (this.destroyed) return;
    const connectionId = `screen-${uuid()}`;
    console.log(`[AVBot ${this.roomId}] -> Calling frontend screen peer ${frontendScreenPeerId} (${alias}) with audio+video`);
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
      console.error(`[AVBot ${this.roomId}] Failed to create AV offer for ${frontendScreenPeerId}:`, err);
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
    console.log(`[AVBot ${this.roomId}] Closed AV peer: ${peerId}`);
    this.checkAutoLeave();
  }

  private sendOpusFrameAV(conn: AVPeerConn, frame: OpusFrame): void {
    if (conn.pc.connectionState !== 'connected') return;
    conn.audioSeq = (conn.audioSeq + 1) & 0xFFFF;
    conn.audioTimestamp = (conn.audioTimestamp + this.OPUS_RTP_TIMESTAMP_STEP) >>> 0;
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