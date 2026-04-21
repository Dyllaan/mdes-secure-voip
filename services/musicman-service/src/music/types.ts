export interface QueueItem {
    id: string;
    url: string;
    title: string;
    channel: string;
    duration: string;
    durationMs: number;
    source?: 'youtube' | 'spotify' | 'soundcloud';
}

export interface RoomPlaybackState {
    roomId: string;
    queue: QueueItem[];
    currentIndex: number;
    currentTrack: QueueItem | null;
    playing: boolean;
    paused: boolean;
    positionMs: number;
    url: string | null;
    videoMode: boolean;
    screenPeerId: string | null;
}

export interface RoomPlaybackEvent {
    roomId: string;
    active: boolean;
    state: RoomPlaybackState | null;
}
