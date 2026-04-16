import { useState } from 'react';
import {
    Music2, Monitor, MonitorOff, Eye, EyeOff,
    ListMusic
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from '@/components/ui/sheet';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useHubLayout } from '@/contexts/HubLayoutContext';
import MusicmanPanel from '@/components/music/MusicManPanel';

type Panel = 'music' | 'screenshare' | null;

interface ActionsSidebarProps {
    screenshareVisible: boolean;
    onShowScreenshare: () => void;
}

interface RailButtonProps {
    icon: React.ReactNode;
    label: string;
    active?: boolean;
    badge?: string | number;
    badgeVariant?: 'default' | 'secondary' | 'destructive' | 'outline';
    dot?: 'green' | 'red' | 'amber';
    onClick: () => void;
}

function RailButton({
    icon, label, active, badge, badgeVariant = 'default', dot, onClick,
}: RailButtonProps) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    onClick={onClick}
                    className={cn(
                        'relative flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-150',
                        active
                            ? 'bg-primary/15 text-primary'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                    aria-label={label}
                >
                    {icon}

                    {/* Numeric badge */}
                    {badge !== undefined && (
                        <Badge
                            variant={badgeVariant}
                            className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[9px] font-mono leading-none flex items-center justify-center"
                        >
                            {badge}
                        </Badge>
                    )}

                    {/* Dot indicator */}
                    {dot && !badge && (
                        <span
                            className={cn(
                                'absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full',
                                dot === 'green' && 'bg-emerald-400',
                                dot === 'red' && 'bg-red-400',
                                dot === 'amber' && 'bg-amber-400',
                            )}
                        />
                    )}

                    {/* Active left-edge indicator */}
                    {active && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-r-full bg-primary" />
                    )}
                </button>
            </TooltipTrigger>
            <TooltipContent side="left" className="text-xs">
                {label}
            </TooltipContent>
        </Tooltip>
    );
}

interface ScreensharePanelProps {
    screenshareVisible: boolean;
    onShowScreenshare: () => void;
}

function ScreensharePanel({ screenshareVisible, onShowScreenshare }: ScreensharePanelProps) {
    const {
            remoteScreenStreams, localScreenStream, isSharing,
            startScreenShare, stopScreenShare,
            dismissedPeerIds, restoreScreenShare,
            hasScreens, totalStreams,
        } = useHubLayout();

    return (
        <div className="flex flex-col gap-4 p-4">
            {/* Share toggle */}
            <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Your screen
                </p>
                <Button
                    data-testid="screenshare-toggle"
                    variant={isSharing ? 'destructive' : 'outline'}
                    size="sm"
                    onClick={isSharing ? stopScreenShare : startScreenShare}
                    className="gap-2 w-full justify-start"
                >
                    {isSharing
                        ? <><MonitorOff className="h-4 w-4" /> Stop sharing</>
                        : <><Monitor className="h-4 w-4" /> Share your screen</>
                    }
                </Button>
            </div>

            {hasScreens && <Separator />}

            {/* Active streams */}
            {hasScreens && (
                <div className="flex flex-col gap-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Active streams · {totalStreams}
                    </p>

                    {/* Local stream */}
                    {isSharing && localScreenStream && (
                        <div className="flex items-center justify-between rounded-lg border px-3 py-2 bg-muted/30">
                            <div className="flex items-center gap-2">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                                <span className="text-sm font-medium">Your screen</span>
                            </div>
                            <span className="text-xs text-muted-foreground">Live</span>
                        </div>
                    )}

                    {/* Remote streams */}
                    {remoteScreenStreams.map((stream) => {
                        const isDismissed = dismissedPeerIds?.has(stream.peerId);
                        return (
                            <div
                                key={stream.peerId}
                                className="flex items-center justify-between rounded-lg border px-3 py-2 bg-muted/30"
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className={cn(
                                        'h-1.5 w-1.5 rounded-full shrink-0',
                                        isDismissed ? 'bg-muted-foreground' : 'bg-emerald-400',
                                    )} />
                                    <span className="text-sm font-medium truncate">
                                        {stream.peerId}
                                    </span>
                                </div>
                                {isDismissed && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-2 text-xs shrink-0"
                                        onClick={() => restoreScreenShare?.(stream.peerId)}
                                    >
                                        Restore
                                    </Button>
                                )}
                            </div>
                        );
                    })}

                    <Separator />

                    {/* Viewer toggle */}
                    <Button
                        data-testid="screenshare-viewer-toggle"
                        variant="outline"
                        size="sm"
                        className="gap-2 w-full justify-start"
                        onClick={() => {
                            onShowScreenshare();
                        }}
                    >
                        {screenshareVisible
                            ? <><EyeOff className="h-4 w-4" /> Hide viewer</>
                            : <><Eye className="h-4 w-4" /> Show viewer</>
                        }
                    </Button>
                </div>
            )}

            {!hasScreens && (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                    <div className="rounded-full bg-muted p-3">
                        <Monitor className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground">No active screenshares</p>
                </div>
            )}
        </div>
    );
}

export default function ActionsSidebar({ screenshareVisible, onShowScreenshare }: ActionsSidebarProps) {
    const [openPanel, setOpenPanel] = useState<Panel>(null);

    const {
        hub,
        hasMusicman,
        onBotJoined,
        activeVoiceChannelId,
        remoteScreenStreams,
        localScreenStream,
        isSharing,
    } = useHubLayout();

    // Only render when in a voice channel
    if (!activeVoiceChannelId) return null;

    const hasScreens = remoteScreenStreams.length > 0 || (isSharing && !!localScreenStream);
    const screenCount = remoteScreenStreams.length + (isSharing && localScreenStream ? 1 : 0);

    const toggle = (panel: Panel) =>
        setOpenPanel(prev => (prev === panel ? null : panel));

    const close = () => setOpenPanel(null);

    return (
        <>

            <div className="w-12 border-l flex flex-col items-center gap-1 py-2 bg-muted/20 shrink-0">
                <RailButton
                    icon={<Music2 className="h-4 w-4" />}
                    label="Music queue"
                    active={openPanel === 'music'}
                    onClick={() => toggle('music')}
                />

                <RailButton
                    icon={<Monitor className="h-4 w-4" />}
                    label="Screen sharing"
                    active={openPanel === 'screenshare'}
                    badge={hasScreens ? screenCount : undefined}
                    dot={isSharing ? 'green' : undefined}
                    onClick={() => toggle('screenshare')}
                />
            </div>

            <Sheet open={openPanel === 'music'} onOpenChange={o => !o && close()}>
                <SheetContent
                    side="right"
                    className="w-80 sm:w-96 p-0 flex flex-col gap-0"
                >
                    <SheetHeader className="px-4 py-3 border-b shrink-0">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <ListMusic className="h-4 w-4 text-muted-foreground" />
                                <SheetTitle className="text-sm font-semibold">Music</SheetTitle>
                            </div>
                        </div>
                        <SheetDescription className="text-xs sr-only">
                            Music bot queue and controls
                        </SheetDescription>
                    </SheetHeader>

                    <div className="flex-1 overflow-y-auto p-3">
                        <MusicmanPanel
                            roomId={activeVoiceChannelId}
                            hubId={hub?.id ?? ''}
                            hasMusicman={hasMusicman}
                            onBotJoined={onBotJoined}
                        />
                    </div>
                </SheetContent>
            </Sheet>

            <Sheet open={openPanel === 'screenshare'} onOpenChange={o => !o && close()}>
                <SheetContent
                    side="right"
                    className="w-80 sm:w-96 p-0 flex flex-col gap-0"
                >
                    <SheetHeader className="px-4 py-3 border-b shrink-0">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Monitor className="h-4 w-4 text-muted-foreground" />
                                <SheetTitle className="text-sm font-semibold">
                                    Screen sharing
                                </SheetTitle>
                                {hasScreens && (
                                    <Badge variant="secondary" className="font-mono text-xs px-1.5 py-0">
                                        {screenCount}
                                    </Badge>
                                )}
                            </div>
                        </div>
                        <SheetDescription className="text-xs sr-only">
                            Manage active screen shares
                        </SheetDescription>
                    </SheetHeader>

                    <ScreensharePanel
                        screenshareVisible={screenshareVisible}
                        onShowScreenshare={onShowScreenshare}
                    />
                </SheetContent>
            </Sheet>
        </>
    );
}
