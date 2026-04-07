type ChatMessage = {
  sender: string;
  message: string;
  alias: string;
  timestamp?: string;
};

type RemoteStream = {
  peerId: string;
  stream: MediaStream;
};

type UserConnectedData = {
  peerId: string;
  alias: string;
  userId?: string;
};

type ChatMessageData = {
  sender: string;
  message: string;
  alias: string;
};

interface Peer {
  peerId: string;
  alias: string;
}

export type { ChatMessage, RemoteStream, UserConnectedData, ChatMessageData, Peer };