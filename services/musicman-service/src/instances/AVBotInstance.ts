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
import { formatErrorForLog, truncateForLog } from '../logging';

const VP8_MAX_RTP_PAYLOAD = 1_200;

interface AVPeerConn {
  pc: RTCPeerConnection;
  audioTrack: MediaStreamTrack;
  audioTransceiver: RTCRtpTransceiver;
  videoTrack: MediaStreamTrack;
  videoTransceiver: RTCRtpTransceiver;
  connectionId: string;
  audioSsrc: number;
  audioSeq: number;
  audioTimestamp: number;
  videoSsrc: number;
  videoSeq: number;
  videoTimestamp: number;
}

export class AVBotInstance extends BotInstance {
  private avPipeline: AVPipeline;
  private screenPeerId: string | null = null;
  private screenPeerWs: WebSocket | null = null;
  private avConns = new Map<string, AVPeerConn>();
  private avIceBuf = new Map<string, IceEntry[]>();
  private screenHbTimer: NodeJS.Timeout | null = null;
  override readonly videoMode: boolean = true;

  private readonly opusRtpTimestampStep = 960;

  constructor(
    roomId: string,
    url: string,
    token: string,
    turnCredentials: TurnCredentials,
  ) {
    super(roomId, url, token, turnCredentials, 'AVBot');
    this.avPipeline = new AVPipeline(url, `AVBot:${roomId}`);
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
    this.avPipeline.on('ended', this.onEnded);
    this.avPipeline.on('error', this.onPipelineError);
  }

  private unwireAVPipeline(): void {
    this.avPipeline.removeListener('audioFrame', this.onAudioFrame);
    this.avPipeline.removeListener('videoFrame', this.onVideoFrame);
    this.avPipeline.removeListener('ended', this.onEnded);
    this.avPipeline.removeListener('error', this.onPipelineError);
  }

  override async start(): Promise<void> {
    this.logger.info('av_bot.starting', { url: truncateForLog(this.url) });
    this.wireAVPipeline();
    await this.connectSignaling();
  }

  override destroy(reason = 'manual'): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.logger.info('av_bot.destroying', {
      reason,
      url: truncateForLog(this.url),
      playback: this.getStatus(),
    });

    this.unwireAVPipeline();
    this.avPipeline.stop();

    if (this.screenHbTimer) {
      clearInterval(this.screenHbTimer);
      this.screenHbTimer = null;
    }
    for (const peerId of [...this.avConns.keys()]) this.closeAVPeer(peerId);

    if (this.socket?.connected) {
      this.socket.emit('screenshare-stopped');
      this.socket.emit('leave-room', { roomId: this.roomId });
      this.socket.disconnect();
    }
    this.screenPeerWs?.close();
    this.screenPeerWs = null;
    this.peerWs?.close();
    this.onDestroyCallback?.(reason);
  }

  override changeTrack(url: string): void {
    if (this.destroyed) return;
    this.logger.info('av_bot.change_track', {
      previousUrl: truncateForLog(this.url),
      nextUrl: truncateForLog(url),
    });
    this.url = url;

    this.unwireAVPipeline();
    this.avPipeline.stop();
    this.avPipeline = new AVPipeline(url, `AVBot:${this.roomId}`);
    this.wireAVPipeline();
    this.avPipeline.start();

    this.emitToRoom('musicman:track-changed', { roomId: this.roomId, url });
  }

  override pause(): void {
    this.avPipeline.pause();
    this.logger.info('av_bot.pause');
    this.emitToRoom('musicman:state-changed', {
      roomId: this.roomId,
      playing: this.avPipeline.running,
      paused: true,
    });
  }

  override resume(): void {
    this.avPipeline.resume();
    this.logger.info('av_bot.resume');
    this.emitToRoom('musicman:state-changed', {
      roomId: this.roomId,
      playing: this.avPipeline.running,
      paused: false,
    });
  }

  override seek(ms: number): void {
    this.logger.info('av_bot.seek', { ms });
    this.avPipeline.seek(ms);
  }

  override getStatus() {
    return {
      ...super.getStatus(),
      playing: this.avPipeline.running,
      paused: this.avPipeline.isPaused,
      positionMs: this.avPipeline.positionMs,
      videoMode: true,
      screenPeerId: this.screenPeerId,
    };
  }

  protected override checkAutoLeave(): void {
    if (this.avConns.size === 0) {
      this.logger.info('av_bot.auto_leave.triggered');
      this.onAutoLeave?.();
    }
  }

  protected override readonly onPipelineError = (error: Error) => {
    this.logger.error('av_pipeline.error', {
      url: truncateForLog(this.url),
      error: formatErrorForLog(error),
    });
  };

  protected override async onAllUsers(users: AllUsersPayload): Promise<void> {
    this.logger.info('av_bot.room_users.received', {
      userCount: users.length,
      aliases: users.map((user) => user.alias),
    });
    const screenPeerId = await this.requestScreenPeerId();
    this.screenPeerId = screenPeerId;
    await this.connectScreenPeerWs(screenPeerId);
    this.avPipeline.start();
    this.socket!.emit('screenshare-started', { screenPeerId });
    this.logger.info('av_bot.stream.started', { screenPeerId });
  }

  protected override connectSignaling(): Promise<void> {
    return new Promise((resolve, reject) => {
      super.connectSignaling().then(resolve).catch(reject);

      queueMicrotask(() => {
        if (!this.socket) return;

        this.socket.on('room-screen-peers', ({ peers }: { peers: Array<{ screenPeerId: string; alias: string }> }) => {
          this.logger.info('av_bot.room_screen_peers.received', { peerCount: peers.length });
          for (const { screenPeerId, alias } of peers) {
            void this.callFrontendScreenPeer(screenPeerId, alias);
          }
        });

        this.socket.on('new-screen-peer', ({ screenPeerId, alias }: { screenPeerId: string; alias: string }) => {
          this.logger.info('av_bot.new_screen_peer.received', { screenPeerId, alias });
          void this.callFrontendScreenPeer(screenPeerId, alias);
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
        const id = payload[config.SCREEN_PEER_ID_KEY];
        if (!id) {
          reject(new Error(`[AVBot ${this.roomId}] screen-peer-assigned missing ${config.SCREEN_PEER_ID_KEY}`));
          return;
        }
        this.logger.info('av_bot.screen_peer_id.assigned', { screenPeerId: id });
        resolve(id);
      });
      this.logger.info('av_bot.screen_peer_id.requested');
      this.socket!.emit('request-screen-peer-id');
    });
  }

  private connectScreenPeerWs(screenPeerId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const { PEER_HOST, PEER_PORT, PEER_PATH, PEER_SECURE } = config;
      const proto = PEER_SECURE ? 'wss' : 'ws';
      const path = PEER_PATH.endsWith('/') ? PEER_PATH : `${PEER_PATH}/`;
      const wsUrl = `${proto}://${PEER_HOST}:${PEER_PORT}${path}peerjs?key=peerjs&id=${encodeURIComponent(screenPeerId)}&token=${uuid()}`;

      this.logger.info('screen_peerws.connect.start', { screenPeerId, wsUrl });
      this.screenPeerWs = new WebSocket(wsUrl);
      const timer = setTimeout(() => reject(new Error(`[AVBot ${this.roomId}] Screen PeerJS WS timed out`)), 10_000);

      this.screenPeerWs.on('open', () => {
        this.logger.info('screen_peerws.connect.open', { screenPeerId });
        this.screenHbTimer = setInterval(() => {
          if (this.screenPeerWs?.readyState === WebSocket.OPEN) {
            this.logger.debug('screen_peerws.heartbeat.send', { screenPeerId });
            this.screenPeerWs.send(JSON.stringify({ type: 'HEARTBEAT' }));
          } else {
            clearInterval(this.screenHbTimer!);
            this.screenHbTimer = null;
          }
        }, 5_000);
      });

      this.screenPeerWs.on('message', async (raw: WebSocket.RawData) => {
        let msg: { type: string; src: string; dst: string; payload: Record<string, unknown> };
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          this.logger.warn('screen_peerws.message.parse_failed', { screenPeerId });
          return;
        }
        switch (msg.type) {
          case 'OPEN':
            clearTimeout(timer);
            this.logger.info('screen_peerws.ready', { screenPeerId });
            resolve();
            break;
          case 'ANSWER':
            await this.onAVAnswer(msg.src, msg.payload);
            break;
          case 'CANDIDATE':
            await this.onAVCandidate(msg.src, msg.payload);
            break;
          case 'LEAVE':
          case 'EXPIRE':
            this.closeAVPeer(msg.src);
            break;
          case 'ID-TAKEN':
            clearTimeout(timer);
            reject(new Error(`[AVBot ${this.roomId}] Screen peer ID already taken: ${screenPeerId}`));
            break;
          case 'ERROR':
            this.logger.error('screen_peerws.server_error', { screenPeerId, payload: msg.payload });
            break;
          default:
            this.logger.debug('screen_peerws.message.ignored', { screenPeerId, type: msg.type });
            break;
        }
      });

      this.screenPeerWs.on('error', (error) => {
        clearTimeout(timer);
        this.logger.error('screen_peerws.error', { screenPeerId, error: formatErrorForLog(error) });
        reject(error);
      });
      this.screenPeerWs.on('close', () => {
        if (this.screenHbTimer) {
          clearInterval(this.screenHbTimer);
          this.screenHbTimer = null;
        }
        if (!this.destroyed) this.logger.warn('screen_peerws.closed', { screenPeerId });
      });
    });
  }

  private sendScreenPeer(type: string, dst: string, payload: Record<string, unknown>): void {
    if (this.screenPeerWs?.readyState !== WebSocket.OPEN) return;
    this.logger.debug('screen_peerws.send', { type, dst, payload });
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
    const peerLogger = this.logger.child('avPeerConnection', { remotePeerId, connectionId });

    const audioTrack = new MediaStreamTrack({ kind: 'audio' });
    const audioTransceiver = pc.addTransceiver(audioTrack, { direction: 'sendonly' });
    const videoTrack = new MediaStreamTrack({ kind: 'video' });
    const videoTransceiver = pc.addTransceiver(videoTrack, { direction: 'sendonly' });

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        peerLogger.debug('ice.candidate.gathered', { candidate: candidate.candidate });
        setTimeout(() => {
          this.sendScreenPeer('CANDIDATE', remotePeerId, {
            candidate: candidate.toJSON(),
            connectionId,
            type: 'media',
          });
        }, 100);
      }
    };

    pc.addEventListener('connectionstatechange', () => {
      const state = pc.connectionState;
      peerLogger.info('peer_connection.state_changed', { state });
      if (state === 'failed' || state === 'closed') this.closeAVPeer(remotePeerId);
    });

    const conn: AVPeerConn = {
      pc,
      audioTrack,
      audioTransceiver,
      videoTrack,
      videoTransceiver,
      connectionId,
      audioSsrc: Math.floor(Math.random() * 0xFFFFFFFF),
      audioSeq: Math.floor(Math.random() * 0xFFFF),
      audioTimestamp: Math.floor(Math.random() * 0xFFFFFFFF),
      videoSsrc: Math.floor(Math.random() * 0xFFFFFFFF),
      videoSeq: Math.floor(Math.random() * 0xFFFF),
      videoTimestamp: Math.floor(Math.random() * 0xFFFFFFFF),
    };
    this.avConns.set(remotePeerId, conn);
    return conn;
  }

  private async callFrontendScreenPeer(frontendScreenPeerId: string, alias: string): Promise<void> {
    const existing = this.avConns.get(frontendScreenPeerId);
    if (existing) {
      try {
        existing.pc.close();
      } catch {
        // Ignore close failures
      }
      this.avConns.delete(frontendScreenPeerId);
      this.avIceBuf.delete(frontendScreenPeerId);
      this.logger.info('av_peer.replaced', { frontendScreenPeerId });
    }
    if (this.destroyed) return;

    const connectionId = `screen-${uuid()}`;
    this.logger.info('av_peer.calling_frontend', { frontendScreenPeerId, alias, connectionId });
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
    } catch (error) {
      this.logger.error('av_peer.offer.failed', {
        frontendScreenPeerId,
        error: formatErrorForLog(error),
      });
      this.closeAVPeer(frontendScreenPeerId);
    }
  }

  private async onAVAnswer(remotePeerId: string, payload: Record<string, unknown>): Promise<void> {
    const conn = this.avConns.get(remotePeerId);
    if (!conn) return;
    this.logger.info('av_peer.answer.received', { remotePeerId, connectionId: conn.connectionId });
    const sdpObj = payload.sdp as { sdp: string; type: string } | string;
    const sdpStr = typeof sdpObj === 'string' ? sdpObj : sdpObj.sdp;
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
    try {
      await conn.pc.addIceCandidate(new RTCIceCandidate(raw));
    } catch (error) {
      this.logger.warn('av_peer.candidate.add_failed', {
        remotePeerId,
        error: formatErrorForLog(error),
      });
    }
  }

  private async drainAVIceBuf(peerId: string, pc: RTCPeerConnection): Promise<void> {
    const buf = this.avIceBuf.get(peerId) ?? [];
    this.avIceBuf.delete(peerId);
    for (const cand of buf) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch {
        // Ignore stale candidates
      }
    }
  }

  private closeAVPeer(peerId: string): void {
    const conn = this.avConns.get(peerId);
    if (!conn) return;
    try {
      conn.pc.close();
    } catch {
      // Ignore close failures
    }
    this.avConns.delete(peerId);
    this.avIceBuf.delete(peerId);
    this.logger.info('av_peer.closed', { peerId });
    this.checkAutoLeave();
  }

  private sendOpusFrameAV(conn: AVPeerConn, frame: OpusFrame): void {
    if (conn.pc.connectionState !== 'connected') return;
    conn.audioSeq = (conn.audioSeq + 1) & 0xFFFF;
    conn.audioTimestamp = (conn.audioTimestamp + this.opusRtpTimestampStep) >>> 0;
    const header = Buffer.alloc(12);
    header[0] = 0x80;
    header[1] = OPUS_PAYLOAD_TYPE & 0x7F;
    header.writeUInt16BE(conn.audioSeq, 2);
    header.writeUInt32BE(conn.audioTimestamp, 4);
    header.writeUInt32BE(conn.audioSsrc, 8);
    try {
      conn.audioTrack.writeRtp(Buffer.concat([header, frame.data]));
    } catch (error) {
      this.logger.error('av_rtp.audio_write.failed', {
        peerId: conn.connectionId,
        error: formatErrorForLog(error),
      });
    }
  }

  private sendVP8Frame(conn: AVPeerConn, frameData: Buffer): void {
    if (conn.pc.connectionState !== 'connected') return;
    conn.videoTimestamp = (conn.videoTimestamp + VP8_TIMESTAMP_STEP) >>> 0;
    let offset = 0;
    while (offset < frameData.length) {
      const isFirst = offset === 0;
      const chunk = frameData.subarray(offset, offset + VP8_MAX_RTP_PAYLOAD);
      const isLast = offset + chunk.length >= frameData.length;
      conn.videoSeq = (conn.videoSeq + 1) & 0xFFFF;
      const header = Buffer.alloc(12);
      header[0] = 0x80;
      header[1] = (isLast ? 0x80 : 0x00) | (VP8_PAYLOAD_TYPE & 0x7F);
      header.writeUInt16BE(conn.videoSeq, 2);
      header.writeUInt32BE(conn.videoTimestamp, 4);
      header.writeUInt32BE(conn.videoSsrc, 8);
      const desc = Buffer.alloc(1);
      desc[0] = isFirst ? 0x10 : 0x00;
      try {
        conn.videoTrack.writeRtp(Buffer.concat([header, desc, chunk]));
      } catch (error) {
        this.logger.error('av_rtp.video_write.failed', {
          connectionId: conn.connectionId,
          error: formatErrorForLog(error),
        });
        return;
      }
      offset += chunk.length;
    }
  }
}
