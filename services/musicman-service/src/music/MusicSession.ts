import { createLogger, truncateForLog, type Logger } from '../logging';
import { BotInstance } from '../instances/BotInstance';
import type { QueueItem, RoomPlaybackEvent, RoomPlaybackState } from './types';

function shuffleItems<T>(items: T[]): T[] {
    const next = [...items];
    for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [next[i], next[j]] = [next[j], next[i]];
    }
    return next;
}

const TRACK_END_SUPPRESSION_MS = 1_500;

export class MusicSession {
    private currentIndex = 0;
    private destroying = false;
    private disposed = false;
    private advancing = false;
    private lastPlaybackTransitionAt = 0;
    private readonly logger: Logger;

    constructor(
        readonly roomId: string,
        private readonly bot: BotInstance,
        private queue: QueueItem[],
        private readonly onDisposed: (roomId: string, reason: string) => void,
    ) {
        this.logger = createLogger('musicSession', { roomId, videoMode: bot.videoMode });
        this.bot.setAutoLeaveCallback(() => {
            this.logger.info('session.auto_leave');
            this.destroy('auto_leave');
        });
        this.bot.setTrackEndedCallback(() => {
            this.handleTrackEnded();
        });
        this.bot.setDestroyCallback((reason) => {
            this.logger.info('session.bot_destroyed', { reason });
            this.handleBotDisposed(reason);
        });
    }

    async start(): Promise<void> {
        this.logger.info('session.start', {
            queueLength: this.queue.length,
            currentUrl: truncateForLog(this.currentItem?.url),
        });
        await this.bot.start();
        this.markPlaybackTransition();
        this.emitState();
    }

    get videoMode(): boolean {
        return this.bot.videoMode;
    }

    get currentItem(): QueueItem | null {
        return this.queue[this.currentIndex] ?? null;
    }

    getState(): RoomPlaybackState {
        const status = this.bot.getStatus();
        const currentTrack = this.currentItem;
        return {
            roomId: this.roomId,
            queue: [...this.queue],
            currentIndex: this.currentIndex,
            currentTrack,
            playing: status.playing,
            paused: status.paused,
            positionMs: status.positionMs,
            url: currentTrack?.url ?? status.url ?? null,
            videoMode: this.bot.videoMode,
            screenPeerId: 'screenPeerId' in status && typeof status.screenPeerId === 'string'
                ? status.screenPeerId
                : null,
        };
    }

    addItems(items: QueueItem[]): RoomPlaybackState {
        this.queue = [...this.queue, ...items];
        this.logger.info('session.queue_added', { addedCount: items.length, queueLength: this.queue.length });
        this.emitState();
        return this.getState();
    }

    playNow(item: QueueItem): RoomPlaybackState {
        this.queue = [item];
        this.currentIndex = 0;
        this.bot.changeTrack(item.url);
        this.markPlaybackTransition();
        this.logger.info('session.play_now', { url: truncateForLog(item.url) });
        this.emitState();
        return this.getState();
    }

    playItem(itemId: string): RoomPlaybackState {
        const index = this.queue.findIndex((item) => item.id === itemId);
        if (index === -1) throw new Error(`Queue item "${itemId}" not found`);
        this.currentIndex = index;
        const item = this.queue[index];
        this.bot.changeTrack(item.url);
        this.markPlaybackTransition();
        this.logger.info('session.play_item', { itemId, index, url: truncateForLog(item.url) });
        this.emitState();
        return this.getState();
    }

    removeItem(itemId: string): RoomPlaybackState | null {
        const index = this.queue.findIndex((item) => item.id === itemId);
        if (index === -1) throw new Error(`Queue item "${itemId}" not found`);

        if (index === this.currentIndex) {
            const nextQueue = this.queue.filter((item) => item.id !== itemId);
            if (nextQueue.length === 0) {
                this.queue = [];
                this.currentIndex = 0;
                this.logger.info('session.queue_empty_after_remove', { itemId });
                this.destroy('queue_empty');
                return null;
            }

            this.queue = nextQueue;
            this.currentIndex = 0;
            this.bot.changeTrack(this.queue[0].url);
            this.markPlaybackTransition();
            this.logger.info('session.current_item_removed', {
                itemId,
                nextUrl: truncateForLog(this.queue[0].url),
                queueLength: this.queue.length,
            });
            this.emitState();
            return this.getState();
        }

        this.queue = this.queue.filter((item) => item.id !== itemId);
        if (index < this.currentIndex) this.currentIndex -= 1;
        this.logger.info('session.queue_item_removed', { itemId, queueLength: this.queue.length });
        this.emitState();
        return this.getState();
    }

    clear(reason = 'queue_cleared'): void {
        this.queue = [];
        this.currentIndex = 0;
        this.logger.info('session.queue_cleared', { reason });
        this.destroy(reason);
    }

    next(): RoomPlaybackState | null {
        if (this.advancing) {
            this.logger.warn('session.advance.ignored', { reason: 'advance_in_progress', requestedBy: 'manual_next' });
            return this.getState();
        }
        this.advancing = true;
        try {
            return this.advance('manual_next');
        } finally {
            this.advancing = false;
        }
    }

    reorder(itemIds: string[]): RoomPlaybackState {
        if (itemIds.length !== this.queue.length) {
            throw new Error('itemIds length must match queue length');
        }

        const byId = new Map(this.queue.map((item) => [item.id, item]));
        const nextQueue = itemIds.map((id) => {
            const item = byId.get(id);
            if (!item) throw new Error(`Queue item "${id}" not found`);
            return item;
        });
        if (new Set(itemIds).size !== itemIds.length) {
            throw new Error('itemIds must be unique');
        }

        const currentId = this.currentItem?.id ?? null;
        this.queue = nextQueue;
        this.currentIndex = currentId ? Math.max(0, this.queue.findIndex((item) => item.id === currentId)) : 0;
        this.logger.info('session.queue_reordered', { currentIndex: this.currentIndex, queueLength: this.queue.length });
        this.emitState();
        return this.getState();
    }

    shuffle(): RoomPlaybackState {
        if (this.queue.length <= 1) return this.getState();

        const current = this.currentItem;
        const remaining = this.queue.filter((item) => item.id !== current?.id);
        this.queue = current ? [current, ...shuffleItems(remaining)] : shuffleItems(this.queue);
        this.currentIndex = current ? 0 : this.currentIndex;
        this.logger.info('session.queue_shuffled', { queueLength: this.queue.length });
        this.emitState();
        return this.getState();
    }

    pause(): RoomPlaybackState {
        this.bot.pause();
        this.emitState();
        return this.getState();
    }

    resume(): RoomPlaybackState {
        this.bot.resume();
        this.emitState();
        return this.getState();
    }

    seek(ms: number): RoomPlaybackState {
        this.bot.seek(ms);
        this.markPlaybackTransition();
        this.emitState();
        return this.getState();
    }

    destroy(reason = 'manual'): void {
        if (this.destroying || this.disposed) return;
        this.destroying = true;
        this.logger.info('session.destroying', { reason, queueLength: this.queue.length });
        this.emitInactive();
        this.bot.destroy(reason);
    }

    private advance(reason: 'track_ended' | 'manual_next'): RoomPlaybackState | null {
        if (this.disposed || this.queue.length === 0) return null;
        const nextQueue = this.queue.filter((_, index) => index !== this.currentIndex);
        if (nextQueue.length === 0) {
            this.queue = [];
            this.currentIndex = 0;
            this.logger.info('session.advance_finished', { reason });
            this.destroy('queue_finished');
            return null;
        }

        this.queue = nextQueue;
        this.currentIndex = 0;
        this.bot.changeTrack(this.queue[0].url);
        this.markPlaybackTransition();
        this.logger.info('session.advance', {
            reason,
            nextUrl: truncateForLog(this.queue[0].url),
            queueLength: this.queue.length,
        });
        this.emitState();
        return this.getState();
    }

    private emitState(): void {
        const payload: RoomPlaybackEvent = {
            roomId: this.roomId,
            active: true,
            state: this.getState(),
        };
        this.bot.emitRoomEvent('musicman:session-state', payload);
    }

    private emitInactive(): void {
        const payload: RoomPlaybackEvent = {
            roomId: this.roomId,
            active: false,
            state: null,
        };
        this.bot.emitRoomEvent('musicman:session-state', payload);
    }

    private handleBotDisposed(reason: string): void {
        if (this.disposed) return;
        this.disposed = true;
        this.destroying = false;
        this.onDisposed(this.roomId, reason);
    }

    private handleTrackEnded(): void {
        if (this.disposed || this.destroying) return;

        const elapsedMs = Date.now() - this.lastPlaybackTransitionAt;
        if (this.advancing) {
            this.logger.warn('session.track_ended.ignored', {
                reason: 'advance_in_progress',
                elapsedMs,
                currentUrl: truncateForLog(this.currentItem?.url),
            });
            return;
        }
        if (elapsedMs < TRACK_END_SUPPRESSION_MS) {
            this.logger.warn('session.track_ended.ignored', {
                reason: 'recent_track_transition',
                elapsedMs,
                currentUrl: truncateForLog(this.currentItem?.url),
            });
            return;
        }

        this.logger.info('session.track_ended');
        this.advancing = true;
        try {
            this.advance('track_ended');
        } finally {
            this.advancing = false;
        }
    }

    private markPlaybackTransition(): void {
        this.lastPlaybackTransitionAt = Date.now();
    }
}
