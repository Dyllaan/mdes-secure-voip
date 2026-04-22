export interface MusicQueueItem {
    id: string;
    url: string;
    title: string;
    channel: string;
    duration: string;
    durationMs: number;
    source?: 'youtube' | 'spotify' | 'soundcloud';
}

export interface MusicRoomState {
    roomId: string;
    queue: MusicQueueItem[];
    currentIndex: number;
    currentTrack: MusicQueueItem | null;
    playing: boolean;
    paused: boolean;
    positionMs: number;
    url: string | null;
    videoMode: boolean;
    screenPeerId: string | null;
}

export interface MusicRoomStateEvent {
    roomId: string;
    active: boolean;
    state: MusicRoomState | null;
}
