import { useVoIPContext } from '@/components/providers/VoIPProvider';
import { Button } from '@/components/ui/button';
import { Volume2, PhoneOff, Mic, MicOff } from 'lucide-react';
import { useEffect, useRef } from 'react';

export default function VoicePanel() {
    const {
        voiceChannel,
        leaveVoiceChannel,
        isVoiceActive,
        remoteStreams,
        muted,
        toggleMute
    } = useVoIPContext();

    const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());

    // Play remote audio streams
    useEffect(() => {
        const currentPeerIds = new Set(remoteStreams.map(rs => rs.peerId));
        console.log('VoicePanel: remoteStreams count:', remoteStreams.length);

        // Remove audio elements for peers that left
        audioElementsRef.current.forEach((audio, peerId) => {
            if (!currentPeerIds.has(peerId)) {
                audio.srcObject = null;
                audio.remove();
                audioElementsRef.current.delete(peerId);
            }
        });

        // Create/update audio elements for current streams
        remoteStreams.forEach(({ peerId, stream }) => {
            let audio = audioElementsRef.current.get(peerId);
            if (!audio) {
                audio = document.createElement('audio');
                audio.autoplay = true;
                // Append to DOM (hidden) so browsers allow playback
                document.body.appendChild(audio);
                audioElementsRef.current.set(peerId, audio);
            }
            if (audio.srcObject !== stream) {
                audio.srcObject = stream;
                audio.play().catch(err => console.warn('Audio autoplay blocked:', err));
            }
        });
    }, [remoteStreams]);

    // Cleanup all audio elements on unmount or when leaving voice
    useEffect(() => {
        return () => {
            audioElementsRef.current.forEach((audio) => {
                audio.srcObject = null;
                audio.remove();
            });
            audioElementsRef.current.clear();
        };
    }, []);


    if (!voiceChannel || !isVoiceActive) return null;

    return (
        <div className="p-3 border-t space-y-2">
            {/* Connection status */}
            <div className="flex items-center gap-2">
                <Volume2 className="h-4 w-4 text-green-400" />
                <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-green-400">Voice Connected</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                        {voiceChannel.channelName}
                    </p>
                </div>
            </div>

            {/* Controls */}
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