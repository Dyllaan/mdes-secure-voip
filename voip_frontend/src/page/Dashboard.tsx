import useVoIP from "@/hooks/useVoIP";
import { useState } from "react";
import Header from "@/components/layout/Header";
import RoomManager from "@/components/room/RoomManager";
import ScreenShareVideo from "@/components/room/screenshare/ScreenshareVideo";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import ChatTab from "@/components/chat/ChatTab";
import { Button } from "@/components/ui/button";
import { Monitor, MonitorOff, X } from "lucide-react";

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
    } = useVoIP();

    const [peerVolumes, setPeerVolumes] = useState<Record<string, number>>({});

    return (
        <div className="h-screen overflow-hidden">
            <SidebarProvider className="h-full flex overflow-hidden">
                <RoomManager
                    currentRoomId={currentRoomId}
                    onJoinRoom={joinRoom}
                    onLeaveRoom={leaveRoom}
                    isConnected={isConnected}
                    noiseGate={noiseGate}
                />
                <SidebarInset className="flex flex-col min-w-0 overflow-hidden h-full">
                    <Header
                        setPeerVolumes={setPeerVolumes}
                        peerVolumes={peerVolumes}
                        socket={socket}
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
                                <ScreenShareVideo
                                    alias={alias}
                                    stream={stream}
                                />
                                {/* Dismiss button — lets the viewer hide the feed */}
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
                </SidebarInset>
            </SidebarProvider>
        </div>
    );
};

export default Dashboard;