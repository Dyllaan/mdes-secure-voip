import Peer from "peerjs";

interface PeerConfig {
  host: string;
  secure: boolean;
  port: number;
  path: string;
}

export default function useCreatePeer(peerId: string, config: PeerConfig, iceServers: RTCIceServer[]): Peer {
  return new Peer(peerId, {
    host: config.host,
    secure: config.secure,
    port: config.port,
    path: config.path,
    debug: 1,
    config: { iceServers },
  });
}