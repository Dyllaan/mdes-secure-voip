import ConnectedPeers from "../room/ConnectedPeers";
import RoomAudio from "../room/RoomAudio";

interface HeaderProps {
    connectedPeers: { peerId: string; alias: string }[];
    setPeerVolumes: (volumes: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => void;
    peerVolumes: Record<string, number>;
    remoteStreams: { peerId: string; stream: MediaStream }[];
    localAudioRef: React.RefObject<HTMLAudioElement | null>;
}

const Header = ({ connectedPeers, setPeerVolumes, peerVolumes, remoteStreams, localAudioRef }: HeaderProps) => {
    return (
        <header className="w-full p-4 shadow-md">
            <div className="flex justify-between items-center mx-auto">
                <ConnectedPeers 
                    connectedPeers={connectedPeers}
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