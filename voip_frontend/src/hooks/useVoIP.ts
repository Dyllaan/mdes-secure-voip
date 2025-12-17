import { useEffect, useRef, useState } from "react";
import Peer from "peerjs";
import type { MediaConnection } from "peerjs";
import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import config from "../config/config";
import { SimpleNoiseGate } from "../utils/SimpleNoiseGate";
import { useAuth } from "./useAuth";
import { SignalProtocolClient } from "../utils/SignalProtocolClient";
import type { DecryptedMessage } from "../utils/SignalProtocolClient";
import type { UserConnectedData } from "@/types/voip.types";

export interface ChatMessage {
    sender: string;
    message: string;
    alias: string;
    timestamp?: string;
}

export interface RemoteStream {
    peerId: string;
    stream: MediaStream;
}

const PEER_HOST = config.PEER_HOST;
const PEER_SECURE = config.PEER_SECURE === "true";
const PEER_PORT = parseInt(config.PEER_PORT, 10);
const PEER_PATH = config.PEER_PATH;

const useVoIP = () => {
    const { accessToken, user, isAuthenticated } = useAuth();
    
    const [myPeerId, setMyPeerId] = useState<string>("");
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [message, setMessage] = useState<string>("");
    const [remoteStreams, setRemoteStreams] = useState<RemoteStream[]>([]);
    const [isConnected, setIsConnected] = useState<boolean>(false);
    const [isEncryptionReady, setIsEncryptionReady] = useState<boolean>(false);
    
    const localAudioRef = useRef<HTMLAudioElement | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const processedStreamRef = useRef<MediaStream | null>(null);
    const noiseGateRef = useRef<SimpleNoiseGate | null>(null);
    const peerRef = useRef<Peer | null>(null);
    const socketRef = useRef<Socket | null>(null);
    const signalClientRef = useRef<SignalProtocolClient | null>(null);

    useEffect(() => {
        // Don't connect until authenticated
        if (!isAuthenticated || !accessToken || !user) {
            console.log('Waiting for authentication...');
            return;
        }

        console.log(' Authenticated as:', user.username);
        console.log(' Connecting to realtime service...');

        // Connect to Socket.IO with JWT token
        const voipSocket = io(config.SIGNALING_SERVER, {
            path: "/socket.io/",
            auth: { token: accessToken },
            transports: ["websocket", "polling"],
            withCredentials: true,
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionAttempts: 5
        });

        socketRef.current = voipSocket;

        voipSocket.on('connect', async () => {
            console.log('Socket.IO connected:', voipSocket.id);
            setIsConnected(true);

            // Initialize Signal Protocol immediately (before joining room)
            if (user.id) {
                try {
                    const signalClient = new SignalProtocolClient(user.id.toString(), voipSocket);
                    signalClientRef.current = signalClient;

                    // Set up room message decryption handler
                    signalClient.onRoomMessageDecrypted = (decryptedMsg: DecryptedMessage) => {
                        console.log(' Room message decrypted from:', decryptedMsg.senderAlias);
                        setChatMessages((prev) => [...prev, {
                            sender: decryptedMsg.senderUserId,
                            message: decryptedMsg.message,
                            alias: decryptedMsg.senderAlias,
                            timestamp: decryptedMsg.timestamp
                        }]);
                    };

                    // Initialize encryption keys IMMEDIATELY
                    console.log(' Starting Signal Protocol initialization...');
                    await signalClient.initialize();
                    console.log('Signal Protocol initialized and ready');
                } catch (error) {
                    console.error('Failed to initialize encryption:', error);
                    setIsEncryptionReady(false);
                }
            }
        });

        voipSocket.on('connect_error', (error) => {
            console.error('Socket.IO connection error:', error.message);
            setIsConnected(false);
        });

        voipSocket.on('disconnect', (reason) => {
            console.log('Socket.IO disconnected:', reason);
            setIsConnected(false);
            setIsEncryptionReady(false);
        });

        // Handle server-assigned peer ID
        voipSocket.on('peer-assigned', ({ peerId }) => {
            console.log(' Server assigned peer ID:', peerId);
            
            // Initialize PeerJS with server-assigned ID
            const newPeer = new Peer(peerId, {
                host: PEER_HOST,
                secure: PEER_SECURE,
                port: PEER_PORT,
                path: PEER_PATH,
                debug: 3,
            });

            peerRef.current = newPeer;

            newPeer.on("open", async (id: string) => {
                console.log('PeerJS connected with ID:', id);
                setMyPeerId(id);
                
                // Wait for Signal Protocol to be initialized before joining room
                const signalClient = signalClientRef.current;
                if (signalClient && !signalClient.isReady()) {
                    console.log('Waiting for Signal Protocol initialization...');
                    // Wait up to 10 seconds for initialization
                    let attempts = 0;
                    while (!signalClient.isReady() && attempts < 40) {
                        await new Promise(resolve => setTimeout(resolve, 250));
                        attempts++;
                    }
                    
                    if (!signalClient.isReady()) {
                        console.error('Signal Protocol initialization timeout');
                    }
                }
                
                const alias = user.username;
                const roomId = "main-room";
                
                console.log('Joining room:', roomId, 'with alias:', alias);
                voipSocket.emit("join-room", { roomId, alias });
            });

            newPeer.on("call", (incomingCall: MediaConnection) => {
                console.log(' Incoming call from:', incomingCall.peer);
                const waitForStream = (): void => {
                    if (processedStreamRef.current) {
                        incomingCall.answer(processedStreamRef.current);
                        console.log('Answered call from:', incomingCall.peer);
                    } else {
                        setTimeout(waitForStream, 100);
                    }
                };
                waitForStream();

                incomingCall.on("stream", (remoteStream: MediaStream) => {
                    console.log(' Received stream from:', incomingCall.peer);
                    setRemoteStreams((prev) => {
                        if (prev.some(rs => rs.peerId === incomingCall.peer)) {
                            return prev;
                        }
                        return [...prev, { peerId: incomingCall.peer, stream: remoteStream }];
                    });
                });
            });

            newPeer.on("error", (error) => {
                console.error('PeerJS error:', error);
            });
        });

        // Get user media with noise gate
        const initializeAudio = async () => {
            try {
                const rawStream = await navigator.mediaDevices.getUserMedia({ 
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                        sampleRate: 48000,
                    }
                });

                localStreamRef.current = rawStream;

                if (localAudioRef.current) {
                    localAudioRef.current.srcObject = rawStream;
                }

                const noiseGate = new SimpleNoiseGate();
                noiseGateRef.current = noiseGate;
                
                const processedStream = await noiseGate.processStream(rawStream);
                processedStreamRef.current = processedStream;

                console.log('Got local audio stream with noise gate');
            } catch (err) {
                console.error("Failed to get local stream", err);
            }
        };

        initializeAudio();

        voipSocket.on("all-users", async (users: Array<{peerId: string, alias: string, userId: string}>) => {
            console.log('Received all-users:', users);
            
            // Join room with encryption
            if (signalClientRef.current) {
                try {
                    const roomId = "main-room"; // Same as join-room
                    const existingUserIds = users.map(u => u.userId);
                    
                    // Wait for room join to complete
                    await signalClientRef.current.joinRoom(roomId, existingUserIds);
                    
                    // Verify encryption is ready
                    if (signalClientRef.current.isRoomReady()) {
                        setIsEncryptionReady(true);
                        console.log(' Joined encrypted room - encryption ready');
                    } else {
                        console.warn('️ Joined room but encryption not ready yet');
                    }
                } catch (error) {
                    console.error('Failed to join encrypted room:', error);
                    setIsEncryptionReady(false);
                }
            }
            
            users.forEach(({ peerId, alias }) => {
                console.log(`Calling existing user: ${peerId} (${alias})`);
                const waitAndCall = (): void => {
                    if (processedStreamRef.current && peerRef.current) {
                        const outgoingCall = peerRef.current.call(peerId, processedStreamRef.current);
                        
                        outgoingCall.on("stream", (remoteStream: MediaStream) => {
                            console.log(' Received stream from existing user:', peerId);
                            setRemoteStreams((prev) => {
                                if (prev.some(rs => rs.peerId === peerId)) {
                                    return prev;
                                }
                                return [...prev, { peerId, stream: remoteStream }];
                            });
                        });

                        outgoingCall.on("error", (error) => {
                            console.error('Error calling', peerId, error);
                        });
                    } else {
                        setTimeout(waitAndCall, 100);
                    }
                };
                waitAndCall();
            });
        });

        voipSocket.on("user-connected", ({ peerId, alias }: UserConnectedData) => {
            console.log(` New user connected: ${peerId} (Alias: ${alias})`);
            
            const waitAndCall = (): void => {
                if (processedStreamRef.current && peerRef.current) {
                    const outgoingCall = peerRef.current.call(peerId, processedStreamRef.current);
                    
                    outgoingCall.on("stream", (remoteStream: MediaStream) => {
                        console.log(' Received stream from new user:', peerId);
                        setRemoteStreams((prev) => {
                            if (prev.some(rs => rs.peerId === peerId)) {
                                return prev;
                            }
                            return [...prev, { peerId, stream: remoteStream }];
                        });
                    });

                    outgoingCall.on("error", (error) => {
                        console.error('Error calling new user', peerId, error);
                    });
                } else {
                    setTimeout(waitAndCall, 100);
                }
            };
            waitAndCall();
        });

        voipSocket.on("user-disconnected", (peerId: string) => {
            console.log(' User disconnected:', peerId);
            setRemoteStreams((prev) => prev.filter((rs) => rs.peerId !== peerId));
        });

        // Handle authentication errors
        voipSocket.on('join-error', ({ message }) => {
            console.error('Join room error:', message);
        });

        voipSocket.on('rate-limit-exceeded', ({ action, retryAfter }) => {
            console.warn('️ Rate limit exceeded for:', action, 'Retry after:', retryAfter);
        });

        return () => {
            console.log('Cleaning up VoIP hook');
            
            // Stop all tracks
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(track => track.stop());
            }
            if (processedStreamRef.current) {
                processedStreamRef.current.getTracks().forEach(track => track.stop());
            }
            
            // Cleanup noise gate
            if (noiseGateRef.current) {
                noiseGateRef.current.cleanup();
            }
            
            // Cleanup Signal Protocol
            if (signalClientRef.current) {
                signalClientRef.current.cleanup();
            }
            
            if (peerRef.current) {
                peerRef.current.destroy();
            }
            
            voipSocket.disconnect();
            setIsConnected(false);
            setIsEncryptionReady(false);
        };
    }, [isAuthenticated, accessToken, user]);

    /**
     * Send encrypted message to room (broadcast to all users)
     */
    const sendMessage = async (): Promise<void> => {
        const signalClient = signalClientRef.current;
        
        if (!signalClient) {
            console.error('Signal client not ready');
            return;
        }

        if (!signalClient.isRoomReady()) {
            console.error('Room encryption not ready');
            return;
        }

        if (message.trim() === "") {
            return;
        }

        try {
            console.log(' Sending encrypted room message:', message);
            
            // Send encrypted message to entire room
            await signalClient.sendRoomMessage(message);
            
            // Add to local state after successful send
            setChatMessages((prev) => [...prev, { 
                sender: "me",
                message: message,
                alias: user?.username || "Me"
            }]);
            
            setMessage("");
            console.log('Encrypted room message sent');
        } catch (error) {
            console.error('Failed to send encrypted message:', error);
        }
    };
    
    return {
        myPeerId,
        chatMessages,
        message,
        setMessage,
        sendMessage,
        remoteStreams,
        localAudioRef,
        socket: socketRef.current,
        noiseGate: noiseGateRef.current,
        isConnected,
        isAuthenticated,
        isEncryptionReady, // New: indicates if E2E encryption is ready
        user,
        signalClient: signalClientRef.current // Expose Signal client if needed
    };
};

export default useVoIP;