import { useAuth } from "../auth/useAuth";

export default function useIceServers(): RTCIceServer[] | null {
    const { turnCredentials } = useAuth();
    if (!turnCredentials) return null;

    return [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        {
            urls: 'turn:mdes.sh:3478?transport=udp',
            username: turnCredentials.username,
            credential: turnCredentials.password,
        },
    ];
}