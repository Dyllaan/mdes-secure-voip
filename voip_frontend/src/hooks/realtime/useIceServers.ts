import { useAuth } from "../auth/useAuth";
import config from "@/config/config";
export default function useIceServers(): RTCIceServer[] | null {
    const { turnCredentials } = useAuth();
    if (!turnCredentials) return null;

    return [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        {
            urls: `turn:${config.TURN_HOST}:${config.TURN_PORT}?transport=udp`,
            username: turnCredentials.username,
            credential: turnCredentials.password,
        },
    ];
}