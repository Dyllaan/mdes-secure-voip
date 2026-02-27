import useVoIP from "@/hooks/useVoIP";
import { useState } from "react";
import Header from "@/components/layout/Header";
import RoomManager from "@/components/room/RoomManager";
import ScreenShareVideo from "@/components/room/screenshare/ScreenshareVideo";
import Page from "@/components/layout/Page";
import ChatTab from "@/components/chat/ChatTab";
import { Button } from "@/components/ui/button";
import { Hash, Monitor, MonitorOff, X } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

const Dashboard = () => {
    const {
        chatMessages,
        message,
        setMessage,
        sendMessage,
        remoteStreams,
        localAudioRef,
        socket,
        noiseGate,
        currentRoomId,
        joinRoom,
        leaveRoom,
        isConnected,
        isSharing,
        remoteScreenStreams,
        startScreenShare,
        stopScreenShare,
        dismissScreenShare,
        connectedPeers,
    } = useVoIP();

    const [peerVolumes, setPeerVolumes] = useState<Record<string, number>>({});
    const [mobileRoomOpen, setMobileRoomOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);

    const isMobile = useIsMobile();

    return (
        <Page className="flex">
            {/* RoomManager - desktop sidebar or mobile drawer */}
            <RoomManager
                socket={socket}
                currentRoomId={currentRoomId}
                onJoinRoom={joinRoom}
                onLeaveRoom={leaveRoom}
                isConnected={isConnected}
                onOpenSettings={() => setSettingsOpen(true)}
                mobileOpen={mobileRoomOpen}
                onMobileClose={() => setMobileRoomOpen(false)}
            />

            {/* Main content */}
            <div className="flex flex-col flex-1 min-w-0 overflow-hidden h-full">
                {/* Mobile top bar - rooms toggle + current room indicator */}
                {isMobile && (
                    <div className="flex items-center gap-2 border-b border-border px-3 py-2 bg-background shrink-0">
                        <button
                            onClick={() => setMobileRoomOpen(true)}
                            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground/70 hover:bg-accent hover:text-foreground transition-colors"
                        >
                            <Hash className="h-3.5 w-3.5" />
                            {currentRoomId
                                ? <span className="font-mono truncate max-w-[120px]">{currentRoomId}</span>
                                : "Rooms"
                            }
                        </button>
                        {/* Connection dot */}
                        <span className={`ml-auto h-2 w-2 rounded-full ${isConnected ? "bg-emerald-400" : "bg-muted-foreground/40"}`} />
                    </div>
                )}

                <Header
                    setPeerVolumes={setPeerVolumes}
                    peerVolumes={peerVolumes}
                    connectedPeers={connectedPeers}
                    remoteStreams={remoteStreams}
                    localAudioRef={localAudioRef}
                />

                <div className="flex-1 overflow-y-auto flex flex-col p-4 gap-4">

                    {/* Screen share toolbar */}
                    {currentRoomId && (
                        <div className="flex items-center gap-2 flex-shrink-0">
                            <Button
                                variant={isSharing ? "destructive" : "outline"}
                                size="sm"
                                onClick={isSharing ? stopScreenShare : startScreenShare}
                                className="gap-2"
                            >
                                {isSharing
                                    ? <><MonitorOff className="h-4 w-4" /> Stop sharing</>
                                    : <><Monitor className="h-4 w-4" /> Share screen</>
                                }
                            </Button>
                            {isSharing && (
                                <span className="text-xs text-muted-foreground">
                                    You are sharing your screen
                                </span>
                            )}
                        </div>
                    )}

                    {/* Remote screen share feeds */}
                    {remoteScreenStreams.map(({ peerId, alias, stream }) => (
                        <div key={peerId} className="relative flex-shrink-0">
                            <ScreenShareVideo alias={alias} stream={stream} />
                            <Button
                                variant="secondary"
                                size="sm"
                                className="absolute top-2 right-2 gap-1.5 bg-black/60 hover:bg-black/80 text-white border-0"
                                onClick={() => dismissScreenShare(peerId)}
                            >
                                <X className="h-3 w-3" />
                                Dismiss
                            </Button>
                        </div>
                    ))}

                    {/* Chat */}
                    <div className="flex-1">
                        <ChatTab
                            messages={chatMessages}
                            message={message}
                            setMessage={setMessage}
                            sendMessage={sendMessage}
                        />
                    </div>
                </div>
            </div>
        </Page>
    );
};

export default Dashboard;