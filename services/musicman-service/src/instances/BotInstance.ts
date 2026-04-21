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
} from '../pipelines/AudioPipeline';
import { config } from '../config';
import { createLogger, formatErrorForLog, type Logger, truncateForLog } from '../logging';

export const OPUS_PAYLOAD_TYPE = 111;

export interface PeerConn {
  pc: RTCPeerConnection;
  track: MediaStreamTrack;
  transceiver: RTCRtpTransceiver;
  connectionId: string;
  ssrc: number;
  seq: number;
  timestamp: number;
  answerSent: boolean;
  pendingCandidates: Array<RTCIceCandidate>;
}

export type IceEntry = { candidate: string; sdpMid?: string; sdpMLineIndex?: number };
export type AllUsersPayload = Array<{ peerId: string; alias: string; userId: string }>;
export type UserConnectedPayload = { peerId: string; alias: string };

export interface TurnCredentials {
  username: string;
  password: string;
}

export interface IceServer {
  urls: string;
  username?: string;
  credential?: string;
}

export class BotInstance {
  protected socket: Socket | null = null;
  protected peerWs: WebSocket | null = null;
  protected myPeerId: string | null = null;

  protected pipeline: AudioPipeline;
  protected url: string;
  protected conns = new Map<string, PeerConn>();
  protected iceBuf = new Map<string, IceEntry[]>();
  protected hbTimer: NodeJS.Timeout | null = null;
  protected destroyed = false;
  protected frameQueue: OpusFrame[] = [];
  protected isConnected = false;

  protected onAutoLeave: (() => void) | null = null;
  protected onTrackEndedCallback: (() => void) | null = null;
  protected onDestroyCallback: ((reason: string) => void) | null = null;
  protected turnCredentials: TurnCredentials;
  protected readonly botType: string;
  protected readonly modeLabel: 'audio' | 'video';
  protected readonly logPrefix: string;
  protected readonly logger: Logger;

  private startedAt = Date.now();
  private readonly GRACE_MS = 60_000;

  readonly roomId: string;
  readonly videoMode: boolean = false;

  private readonly scheme = config.TURN_SECURE ? 'turns' : 'turn';
  private _rtpLogCount = 0;

  constructor(
    roomId: string,
    url: string,
    protected readonly token: string,
    turnCredentials: TurnCredentials,
    botType = 'Bot',
  ) {
    this.roomId = roomId;
    this.url = url;
    this.turnCredentials = turnCredentials;
    this.botType = botType;
    this.modeLabel = botType === 'AVBot' ? 'video' : 'audio';
    this.logPrefix = `[${botType} ${roomId}]`;
    this.logger = createLogger('botInstance', {
      botType,
      roomId,
      mode: this.modeLabel,
    });
    this.pipeline = new AudioPipeline(url, `${botType}:${roomId}`);

    this.logger.info('bot.created', { url: truncateForLog(url) });
  }

  protected buildIceServers(): IceServer[] {
    const primaryUrl = `${this.scheme}:${config.TURN_HOST}:${config.TURN_PORT}?transport=udp`;
    this.logger.info('turn_servers.built', {
      turnSecure: config.TURN_SECURE,
      primaryUrl,
    });

    return [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      {
        urls: primaryUrl,
        username: this.turnCredentials.username,
        credential: this.turnCredentials.password,
      },
      {
        urls: `turn:${config.TURN_HOST}:3478?transport=udp`,
        username: this.turnCredentials.username,
        credential: this.turnCredentials.password,
      },
    ];
  }

  setAutoLeaveCallback(cb: () => void): void {
    this.onAutoLeave = cb;
  }

  setTrackEndedCallback(cb: () => void): void {
    this.onTrackEndedCallback = cb;
  }

  setDestroyCallback(cb: (reason: string) => void): void {
    this.onDestroyCallback = cb;
  }

  protected readonly onAudioFrame = (frame: OpusFrame) => {
    if (this.isConnected) {
      for (const conn of this.conns.values()) this.sendOpusFrame(conn, frame);
    } else {
      this.frameQueue.push(frame);
    }
  };

  protected readonly onEnded = (code: number | null) => {
    this.logger.info('pipeline.ended', {
      code,
      url: truncateForLog(this.url),
      playback: this.getStatus(),
    });
    this.emitToRoom('musicman:track-ended', { roomId: this.roomId });
    this.onTrackEndedCallback?.();
  };

  protected readonly onPipelineError = (error: Error) => {
    this.logger.error('pipeline.error', {
      url: truncateForLog(this.url),
      error: formatErrorForLog(error),
    });
  };

  protected wirePipeline(): void {
    this.pipeline.on('frame', this.onAudioFrame);
    this.pipeline.on('ended', this.onEnded);
    this.pipeline.on('error', this.onPipelineError);
  }

  protected unwirePipeline(): void {
    this.pipeline.removeListener('frame', this.onAudioFrame);
    this.pipeline.removeListener('ended', this.onEnded);
    this.pipeline.removeListener('error', this.onPipelineError);
  }

  async start(): Promise<void> {
    this.logger.info('bot.starting', { url: truncateForLog(this.url) });
    this.wirePipeline();
    await this.connectSignaling();
  }

  destroy(reason = 'manual'): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.logger.info('bot.destroying', {
      reason,
      url: truncateForLog(this.url),
      playback: this.getStatus(),
    });

    this.unwirePipeline();
    this.pipeline.stop();
    this.frameQueue = [];

    if (this.hbTimer) {
      clearInterval(this.hbTimer);
      this.hbTimer = null;
    }
    for (const peerId of [...this.conns.keys()]) this.closePeer(peerId);

    if (this.socket?.connected) {
      this.logger.info('signaling.leave_room.sent', { roomId: this.roomId });
      this.socket.emit('leave-room', { roomId: this.roomId });
      this.socket.disconnect();
    }
    this.peerWs?.close();
    this.onDestroyCallback?.(reason);
  }

  changeTrack(url: string): void {
    if (this.destroyed) return;
    this.logger.info('bot.change_track', {
      previousUrl: truncateForLog(this.url),
      nextUrl: truncateForLog(url),
    });
    this.url = url;

    this.unwirePipeline();
    this.pipeline.stop();
    this.frameQueue = [];
    this.pipeline = new AudioPipeline(url, `${this.botType}:${this.roomId}`);
    this.wirePipeline();
    this.pipeline.start();

    this.emitToRoom('musicman:track-changed', { roomId: this.roomId, url });
  }

  pause(): void {
    this.pipeline.pause();
    this.logger.info('bot.pause');
    this.emitToRoom('musicman:state-changed', {
      roomId: this.roomId,
      playing: this.pipeline.running,
      paused: true,
    });
  }

  resume(): void {
    this.pipeline.resume();
    this.logger.info('bot.resume');
    this.emitToRoom('musicman:state-changed', {
      roomId: this.roomId,
      playing: this.pipeline.running,
      paused: false,
    });
  }

  seek(ms: number): void {
    this.logger.info('bot.seek', { ms });
    this.pipeline.seek(ms);
  }

  getStatus(): { playing: boolean; paused: boolean; positionMs: number; url: string } {
    return {
      playing: this.pipeline.running,
      paused: this.pipeline.isPaused,
      positionMs: this.pipeline.positionMs,
      url: this.url,
    };
  }

  emitRoomEvent(event: string, data: unknown): void {
    this.emitToRoom(event, data);
  }

  protected emitToRoom(event: string, data: unknown): void {
    if (this.socket?.connected) {
      this.logger.debug('socket.emit', { event, payload: data });
      this.socket.emit(event, data);
    }
  }

  protected checkAutoLeave(): void {
    if (Date.now() - this.startedAt < this.GRACE_MS) return;
    if (this.conns.size === 0) {
      this.logger.info('bot.auto_leave.triggered');
      this.onAutoLeave?.();
    }
  }

  protected async callPeer(remotePeerId: string): Promise<void> {
    if (this.destroyed || this.conns.has(remotePeerId)) return;
    const connectionId = uuid();
    this.logger.info('peer.offer.sending', { remotePeerId, connectionId });

    const conn = this.makePc(remotePeerId, connectionId);
    const offer = await conn.pc.createOffer();
    await conn.pc.setLocalDescription(offer);

    this.sendPeer('OFFER', remotePeerId, {
      sdp: { sdp: offer.sdp, type: offer.type },
      connectionId,
      browser: 'node-bot',
    });
  }

  protected async onAllUsers(users: AllUsersPayload): Promise<void> {
    this.logger.info('room.users.received', {
      userCount: users.length,
      aliases: users.map((user) => user.alias),
    });
    await Promise.allSettled(
      users
        .filter(({ peerId }) => peerId && peerId !== this.myPeerId)
        .map(async ({ peerId, alias }) => {
          try {
            await this.callPeer(peerId);
          } catch (error) {
            this.logger.warn('peer.call_failed', {
              remotePeerId: peerId,
              alias,
              error: formatErrorForLog(error),
            });
          }
        }),
    );
    this.pipeline.start();
  }

  protected connectSignaling(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = io(config.SIGNALING_URL, {
        auth: { token: this.token, username: config.BOT_USERNAME },
        transports: ['websocket'],
      });
      this.logger.info('signaling.connect.start', { signalingUrl: config.SIGNALING_URL });

      const timer = setTimeout(
        () => reject(new Error(`[Bot ${this.roomId}] Socket.IO connection timed out`)),
        15_000,
      );

      this.socket.on(config.PEER_ID_EVENT, async (payload: Record<string, string>) => {
        const peerId = payload[config.PEER_ID_KEY];

        if (!peerId) {
          clearTimeout(timer);
          reject(new Error(
            `[Bot ${this.roomId}] '${config.PEER_ID_EVENT}' fired but key '${config.PEER_ID_KEY}' was missing. Payload: ${JSON.stringify(payload)}`,
          ));
          return;
        }

        this.myPeerId = peerId;
        this.logger.info('signaling.peer_id.assigned', { peerId });

        try {
          await this.connectPeerWs(peerId);
        } catch (error) {
          clearTimeout(timer);
          reject(error);
          return;
        }

        this.socket!.once('all-users', async (users: AllUsersPayload) => {
          clearTimeout(timer);
          try {
            await this.onAllUsers(users);
            resolve();
          } catch (error) {
            reject(error);
          }
        });

        this.socket!.emit('join-room', {
          roomId: this.roomId,
          alias: 'musicman',
          userId: config.BOT_USERNAME,
        });
        this.logger.info('signaling.join_room.sent', { roomId: this.roomId, peerId });
      });

      this.socket.on('user-connected', ({ peerId, alias }: UserConnectedPayload) => {
        this.logger.info('signaling.user_connected', { peerId, alias });
        void this.callPeer(peerId).catch((error) => {
          this.logger.warn('peer.call_failed', {
            remotePeerId: peerId,
            alias,
            error: formatErrorForLog(error),
          });
        });
      });

      this.socket.on('user-disconnected', (peerId: string) => {
        this.logger.info('signaling.user_disconnected', { peerId });
        this.closePeer(peerId);
      });

      this.socket.on('room-closed', () => {
        this.logger.warn('signaling.room_closed');
        this.destroy('room_closed');
      });

      this.socket.on('join-error', ({ message: msg }: { message: string }) => {
        this.logger.error('signaling.join_error', { errorMessage: msg });
      });

      this.socket.on('connect_error', (error: Error) => {
        clearTimeout(timer);
        this.logger.error('signaling.connect_error', { error: formatErrorForLog(error) });
        reject(error);
      });
    });
  }

  protected connectPeerWs(peerId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const { PEER_HOST, PEER_PORT, PEER_PATH, PEER_SECURE } = config;
      const proto = PEER_SECURE ? 'wss' : 'ws';
      const path = PEER_PATH.endsWith('/') ? PEER_PATH : `${PEER_PATH}/`;
      const wsUrl = `${proto}://${PEER_HOST}:${PEER_PORT}${path}peerjs?key=peerjs&id=${encodeURIComponent(peerId)}&token=${encodeURIComponent(this.token)}`;

      this.logger.info('peerws.connect.start', { peerId, wsUrl });
      this.peerWs = new WebSocket(wsUrl);

      const timer = setTimeout(
        () => reject(new Error(`[Bot ${this.roomId}] PeerJS WS timed out`)),
        10_000,
      );

      this.peerWs.on('open', () => {
        this.logger.info('peerws.connect.open', { peerId });
        this.hbTimer = setInterval(() => {
          if (this.peerWs?.readyState === WebSocket.OPEN) {
            this.logger.debug('peerws.heartbeat.send', { peerId });
            this.peerWs.send(JSON.stringify({ type: 'HEARTBEAT' }));
          } else {
            clearInterval(this.hbTimer!);
            this.hbTimer = null;
          }
        }, 5_000);
      });

      this.peerWs.on('message', async (raw: WebSocket.RawData) => {
        let msg: { type: string; src: string; dst: string; payload: Record<string, unknown> };
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          this.logger.warn('peerws.message.parse_failed');
          return;
        }

        switch (msg.type) {
          case 'OPEN':
            clearTimeout(timer);
            this.logger.info('peerws.ready', { peerId });
            resolve();
            break;
          case 'OFFER':
            await this.onOffer(msg.src, msg.payload);
            break;
          case 'ANSWER':
            await this.onAnswer(msg.src, msg.payload);
            break;
          case 'CANDIDATE':
            await this.onCandidate(msg.src, msg.payload);
            break;
          case 'LEAVE':
          case 'EXPIRE':
            this.closePeer(msg.src);
            break;
          case 'ERROR':
            this.logger.error('peerws.server_error', { peerId, payload: msg.payload });
            break;
          case 'ID-TAKEN':
            reject(new Error(`[Bot ${this.roomId}] Peer ID already taken: ${peerId}`));
            break;
          default:
            this.logger.debug('peerws.message.ignored', { peerId, type: msg.type });
            break;
        }
      });

      this.peerWs.on('error', (error) => {
        clearTimeout(timer);
        this.logger.error('peerws.error', { peerId, error: formatErrorForLog(error) });
        reject(error);
      });
      this.peerWs.on('close', () => {
        if (this.hbTimer) {
          clearInterval(this.hbTimer);
          this.hbTimer = null;
        }
        if (!this.destroyed) this.logger.warn('peerws.closed_unexpectedly', { peerId });
      });
    });
  }

  protected sendPeer(type: string, dst: string, payload: Record<string, unknown>): void {
    if (this.peerWs?.readyState !== WebSocket.OPEN) return;
    this.logger.debug('peerws.send', { type, dst, payload });
    this.peerWs.send(JSON.stringify({ type, src: this.myPeerId, dst, payload }));
  }

  private sendCandidate(remotePeerId: string, candidate: RTCIceCandidate, connectionId: string): void {
    setTimeout(() => {
      this.sendPeer('CANDIDATE', remotePeerId, {
        candidate: candidate.toJSON(),
        connectionId,
        type: 'media',
      });
    }, 100);
  }

  protected makePc(remotePeerId: string, connectionId: string): PeerConn {
    const pc = new RTCPeerConnection({ iceServers: this.buildIceServers() });
    const track = new MediaStreamTrack({ kind: 'audio' });
    const transceiver = pc.addTransceiver(track, { direction: 'sendonly' });
    const peerLogger = this.logger.child('peerConnection', { remotePeerId, connectionId });

    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) {
        peerLogger.info('ice.gathering.complete');
        return;
      }
      peerLogger.debug('ice.candidate.gathered', { candidate: candidate.candidate });
      const conn = this.conns.get(remotePeerId);
      if (!conn) return;
      if (!conn.answerSent) {
        conn.pendingCandidates.push(candidate);
        return;
      }
      this.sendCandidate(remotePeerId, candidate, connectionId);
    };

    pc.onicegatheringstatechange = () => {
      peerLogger.info('ice.gathering.state_changed', { state: pc.iceGatheringState });
    };

    pc.oniceconnectionstatechange = () => {
      peerLogger.info('ice.connection.state_changed', { state: pc.iceConnectionState });
    };

    pc.addEventListener('connectionstatechange', () => {
      const state = pc.connectionState;
      peerLogger.info('peer_connection.state_changed', { state });
      if (state === 'connected') {
        this.isConnected = true;
        const conn = this.conns.get(remotePeerId);
        if (conn && this.frameQueue.length > 0) {
          this.logger.info('audio.frame_queue.flushed', {
            remotePeerId,
            bufferedFrames: this.frameQueue.length,
          });
          for (const frame of this.frameQueue) this.sendOpusFrame(conn, frame);
          this.frameQueue = [];
        }
      }
      if (state === 'failed') {
        this.isConnected = this.conns.size > 1;
        this.closePeer(remotePeerId);
      }
    });

    const conn: PeerConn = {
      pc,
      track,
      transceiver,
      connectionId,
      ssrc: Math.floor(Math.random() * 0xFFFFFFFF),
      seq: Math.floor(Math.random() * 0xFFFF),
      timestamp: Math.floor(Math.random() * 0xFFFFFFFF),
      answerSent: false,
      pendingCandidates: [],
    };
    this.conns.set(remotePeerId, conn);
    return conn;
  }

  protected async onOffer(remotePeerId: string, payload: Record<string, unknown>): Promise<void> {
    if (this.destroyed) return;
    if (this.conns.has(remotePeerId)) {
      if (this.myPeerId! < remotePeerId) return;
      this.closePeer(remotePeerId);
    }

    const connectionId = payload.connectionId as string;
    this.logger.info('peer.offer.received', { remotePeerId, connectionId });

    const conn = this.makePc(remotePeerId, connectionId);
    const sdpObj = payload.sdp as { sdp: string; type: string } | string;
    const sdpStr = typeof sdpObj === 'string' ? sdpObj : sdpObj.sdp;
    const sdpType = typeof sdpObj === 'string' ? payload.type as string : sdpObj.type;

    await conn.pc.setRemoteDescription(new RTCSessionDescription(sdpStr, sdpType as 'offer' | 'answer'));
    await this.drainIceBuf(remotePeerId, conn.pc);

    const answer = await conn.pc.createAnswer();
    await conn.pc.setLocalDescription(answer);

    this.sendPeer('ANSWER', remotePeerId, {
      sdp: { sdp: answer.sdp, type: answer.type },
      connectionId,
      browser: 'node-bot',
    });

    conn.answerSent = true;
    for (const candidate of conn.pendingCandidates) {
      this.sendCandidate(remotePeerId, candidate, connectionId);
    }
    conn.pendingCandidates = [];
  }

  protected async onAnswer(remotePeerId: string, payload: Record<string, unknown>): Promise<void> {
    const conn = this.conns.get(remotePeerId);
    if (!conn) return;
    this.logger.info('peer.answer.received', { remotePeerId, connectionId: conn.connectionId });
    const sdpObj = payload.sdp as { sdp: string; type: string } | string;
    const sdpStr = typeof sdpObj === 'string' ? sdpObj : sdpObj.sdp;
    const sdpType = typeof sdpObj === 'string' ? payload.type as string : sdpObj.type;
    await conn.pc.setRemoteDescription(new RTCSessionDescription(sdpStr, sdpType as 'offer' | 'answer'));
    await this.drainIceBuf(remotePeerId, conn.pc);
    conn.answerSent = true;
    for (const candidate of conn.pendingCandidates) {
      this.sendCandidate(remotePeerId, candidate, conn.connectionId);
    }
    conn.pendingCandidates = [];
  }

  protected async onCandidate(remotePeerId: string, payload: Record<string, unknown>): Promise<void> {
    const raw = payload.candidate as IceEntry | null;
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
    } catch (error) {
      this.logger.warn('ice.candidate.add_failed', {
        remotePeerId,
        error: formatErrorForLog(error),
      });
    }
  }

  protected async drainIceBuf(peerId: string, pc: RTCPeerConnection): Promise<void> {
    const buf = this.iceBuf.get(peerId) ?? [];
    this.iceBuf.delete(peerId);
    for (const candidate of buf) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // Ignore stale candidates
      }
    }
  }

  protected closePeer(peerId: string): void {
    const conn = this.conns.get(peerId);
    if (!conn) return;
    try {
      conn.pc.close();
    } catch {
      // Ignore close failures
    }
    this.conns.delete(peerId);
    this.iceBuf.delete(peerId);
    this.logger.info('peer.closed', { peerId });
    this.checkAutoLeave();
  }

  protected sendOpusFrame(conn: PeerConn, frame: OpusFrame): void {
    if (conn.pc.connectionState !== 'connected') return;
    conn.seq = (conn.seq + 1) & 0xFFFF;
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
        this.logger.debug('rtp.write.success', {
          logCount: this._rtpLogCount,
          ssrc: conn.ssrc,
          seq: conn.seq,
          payloadType: OPUS_PAYLOAD_TYPE,
          bytes: pkt.length,
        });
      }
    } catch (error) {
      if (this._rtpLogCount < 3) {
        this._rtpLogCount++;
        this.logger.error('rtp.write.failed', {
          logCount: this._rtpLogCount,
          error: formatErrorForLog(error),
        });
      }
    }
  }
}
