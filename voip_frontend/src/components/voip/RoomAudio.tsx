import AudioWithVolume from "./AudioWithVolume.js";
import {useEffect} from "react";

type RoomAudioProps = {
    remoteStreams: { peerId: string; stream: MediaStream }[];
    localAudioRef: React.RefObject<HTMLAudioElement | null>;
    peerVolumes: { [peerId: string]: number };
};

export default function RoomAudio({ remoteStreams, localAudioRef, peerVolumes } : RoomAudioProps) {
    useEffect(() => {
        console.log(peerVolumes)
    }, [peerVolumes]);

    return (
        <div>
            <audio ref={localAudioRef} autoPlay muted className="hidden" />
            {remoteStreams.map(({ peerId, stream }) => (
                <AudioWithVolume
                    key={peerId}
                    stream={stream}
                    volume={peerVolumes[peerId] || 1}  // default volume is 1
                />
            ))}
        </div>
    );
}