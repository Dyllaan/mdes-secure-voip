import ConnectedPeers from "../room/ConnectedPeers";
import { Socket } from "socket.io-client";
import RoomAudio from "../room/RoomAudio";

interface HeaderProps {
    socket: Socket | null;
    setPeerVolumes: (volumes: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => void;
    peerVolumes: Record<string, number>;
    remoteStreams: { peerId: string; stream: MediaStream }[];
    localAudioRef: React.RefObject<HTMLAudioElement | null>;
}

const Header = ({ socket, setPeerVolumes, peerVolumes, remoteStreams, localAudioRef }: HeaderProps) => {
    return (
        <header className="w-full p-4 shadow-md">
            <div className="flex justify-between items-center mx-auto">
                <ConnectedPeers 
                    socket={socket} 
                    setPeerVolumes={setPeerVolumes} 
                />
                <RoomAudio 
                    remoteStreams={remoteStreams} 
                    localAudioRef={localAudioRef} 
                    peerVolumes={peerVolumes}
                />
            </div>
        </header>
    );
};

export default Header;