import { useAuth } from "../auth/useAuth";
import config from "@/config/config";
export default function useIceServers(): RTCIceServer[] | null {
    const { turnCredentials } = useAuth();
    if (!turnCredentials) return null;
    const scheme = config.TURN_SECURE ? 'turns' : 'turn';
    
    return [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        {
            urls: `${scheme}:${config.TURN_HOST}:${config.TURN_PORT}?transport=udp`,
            username: turnCredentials.username,
            credential: turnCredentials.password,
        },
        {
            urls: `turn:${config.TURN_HOST}:3478?transport=udp`,
            username: turnCredentials.username,
            credential: turnCredentials.password,
        },
    ];
}