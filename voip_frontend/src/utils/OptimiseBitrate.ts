/**
 * Modifies SDP to optimize Opus codec for higher audio quality.
 *
 * Default WebRTC Opus: ~32kbps, narrowband, mono - optimized for intelligibility.
 * This pushes it to: 128kbps, fullband (48kHz), stereo-capable, with FEC.
 *
 */
export function optimiseBitrate(sdp: string): string {
    return sdp.replace(
        /a=fmtp:111 (.+)/,
        'a=fmtp:111 $1;maxaveragebitrate=128000;stereo=1;sprop-stereo=1;maxplaybackrate=48000;cbr=0'
    );
}