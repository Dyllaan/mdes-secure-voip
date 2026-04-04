type ChatMessage = {
    sender: string;
    message: string;
    alias: string;
}

type RemoteStream = {
    peerId: string;
    stream: MediaStream;
}

type UserConnectedData = {
    peerId: string;
    alias: string;
    userId?: string; // present when server echoes join-room payload; used to detect bots
}

type ChatMessageData = {
    sender: string;
    message: string;
    alias: string;
}

type AudioConfig = {
    stream: MediaStream;
    volume: number;
}

interface Peer {
    peerId: string;
    alias: string;
}

export type { ChatMessage, RemoteStream, UserConnectedData, ChatMessageData, AudioConfig, Peer };