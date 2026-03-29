import { useVoIPContext } from '@/components/providers/VoIPProvider';
import { Button } from '@/components/ui/button';
import { Volume2, PhoneOff, Mic, MicOff } from 'lucide-react';
import { useEffect, useRef, useCallback } from 'react';

const VOLUME_STORAGE_KEY = 'talk:peer-volumes';

function loadSavedVolumes(): Record<string, number> {
    try { return JSON.parse(localStorage.getItem(VOLUME_STORAGE_KEY) ?? '{}'); } catch { return {}; }
}

function saveVolume(alias: string, volume: number) {
    try {
        const all = loadSavedVolumes();
        all[alias] = volume;
        localStorage.setItem(VOLUME_STORAGE_KEY, JSON.stringify(all));
    } catch {}
}

export default function VoicePanel() {
    const {
        voiceChannel,
        leaveVoiceChannel,
        isVoiceActive,
        remoteStreams,
        connectedPeers,
        peerVolumes,
        setPeerVolume,
        muted,
        toggleMute,
    } = useVoIPContext();

    const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());

    const aliasForPeer = useCallback((peerId: string) =>
        connectedPeers.find(p => p.peerId === peerId)?.alias ?? peerId.split('-')[0],
    [connectedPeers]);

    // Restore saved volumes when peers connect
    useEffect(() => {
        const saved = loadSavedVolumes();
        connectedPeers.forEach(({ peerId, alias }) => {
            if (peerVolumes[peerId] === undefined && saved[alias] !== undefined) {
                setPeerVolume(peerId, saved[alias]);
            }
        });
    }, [connectedPeers]);

    // Apply volume changes to the live audio elements
    useEffect(() => {
        audioElementsRef.current.forEach((audio, peerId) => {
            const vol = peerVolumes[peerId];
            if (vol !== undefined) audio.volume = vol;
        });
    }, [peerVolumes]);

    // Create/remove audio elements for remote streams
    useEffect(() => {
        const currentPeerIds = new Set(remoteStreams.map(rs => rs.peerId));

        audioElementsRef.current.forEach((audio, peerId) => {
            if (!currentPeerIds.has(peerId)) {
                audio.srcObject = null;
                audio.remove();
                audioElementsRef.current.delete(peerId);
            }
        });

        remoteStreams.forEach(({ peerId, stream }) => {
            let audio = audioElementsRef.current.get(peerId);
            if (!audio) {
                audio = document.createElement('audio');
                audio.autoplay = true;
                const vol = peerVolumes[peerId];
                if (vol !== undefined) audio.volume = vol;
                document.body.appendChild(audio);
                audioElementsRef.current.set(peerId, audio);
            }
            if (audio.srcObject !== stream) {
                audio.srcObject = stream;
                audio.play().catch(err => console.warn('Audio autoplay blocked:', err));
            }
        });
    }, [remoteStreams]);

    useEffect(() => {
        return () => {
            audioElementsRef.current.forEach((audio) => {
                audio.srcObject = null;
                audio.remove();
            });
            audioElementsRef.current.clear();
        };
    }, []);

    const handleVolumeChange = (peerId: string, volume: number) => {
        setPeerVolume(peerId, volume);
        saveVolume(aliasForPeer(peerId), volume);
    };

    if (!voiceChannel || !isVoiceActive) return null;

    return (
        <div className="p-3 border-t space-y-2">
            <div className="flex items-center gap-2">
                <Volume2 className="h-4 w-4 text-green-400" />
                <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-green-400">Voice Connected</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                        {voiceChannel.channelName}
                    </p>
                </div>
            </div>

            {/* Per-user volume sliders */}
            {remoteStreams.length > 0 && (
                <div className="space-y-1.5 pt-1">
                    {remoteStreams.map(({ peerId }) => {
                        const alias = aliasForPeer(peerId);
                        const vol = peerVolumes[peerId] ?? 1;
                        return (
                            <div key={peerId} className="flex items-center gap-2">
                                <span className="text-[11px] text-muted-foreground truncate flex-1">{alias}</span>
                                <Volume2 className="h-3 w-3 text-muted-foreground shrink-0" />
                                <input
                                    type="range"
                                    min={0} max={1} step={0.05}
                                    value={vol}
                                    onChange={e => handleVolumeChange(peerId, parseFloat(e.target.value))}
                                    className="w-20 h-1 accent-primary cursor-pointer shrink-0"
                                    title={`${alias} volume: ${Math.round(vol * 100)}%`}
                                />
                            </div>
                        );
                    })}
                </div>
            )}

            <div className="flex gap-1">
                <Button
                    size="sm"
                    variant={muted ? "destructive" : "outline"}
                    className="flex-1 gap-1.5 h-8 text-xs"
                    onClick={toggleMute}
                >
                    {muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                    {muted ? 'Unmute' : 'Mute'}
                </Button>
                <Button
                    size="sm"
                    variant="destructive"
                    className="flex-1 gap-1.5 h-8 text-xs"
                    onClick={leaveVoiceChannel}
                >
                    <PhoneOff className="h-3.5 w-3.5" />
                    Disconnect
                </Button>
            </div>
        </div>
    );
}