import AudioWithVolume from "../voip/AudioWithVolume.js";

type RoomAudioProps = {
    remoteStreams: { peerId: string; stream: MediaStream }[];
    localAudioRef: React.RefObject<HTMLAudioElement | null>;
    peerVolumes: { [peerId: string]: number };
};

export default function RoomAudio({ remoteStreams, localAudioRef, peerVolumes } : RoomAudioProps) {
    return (
        <div>
            <audio ref={localAudioRef} autoPlay muted className="hidden" />
            {remoteStreams.map(({ peerId, stream }) => (
                <AudioWithVolume
                    key={peerId}
                    stream={stream}
                    volume={peerVolumes[peerId] ?? 0.4}
                />
            ))}
        </div>
    );
}