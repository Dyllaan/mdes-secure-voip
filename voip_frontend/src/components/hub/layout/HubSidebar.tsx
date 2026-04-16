import { Button } from "@/components/ui/button";
import VoicePanel from "@/components/voip/VoicePanel";
import { ArrowLeft, Hash, Users, MessageSquare, Volume2 } from "lucide-react";
import { useHubLayout } from "@/contexts/HubLayoutContext";
import { HubMembersDrawer } from "../HubMembersDrawer";
import MembersList from "../../room/MembersList";
import { useVoIPContext } from "@/components/providers/VoIPProvider";
import CreateChannel from "./CreateChannel";

export default function HubSidebar() {
  const {
    hub, channels, memberCount, isOwner,
    channelId, activeVoiceChannelId,
    isConnected, ephem,
    onNavigateBack, onChannelClick,
    members
  } = useHubLayout();
  
  const { roomList } = useVoIPContext();


  return (
    <div className="w-60 border-r flex flex-col bg-muted/30">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold truncate">{hub?.name}</h2>
          <Button variant="ghost" size="icon" onClick={onNavigateBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </div>
        <HubMembersDrawer
          members={members}
          viewerIsOwner={isOwner}
          hub={hub!}
          trigger={
            <Button variant="outline" size="sm" className="mt-2 w-full gap-2">
              <Users className="h-3.5 w-3.5" />
              {memberCount} members
            </Button>
          }
        />
      </div>

      {isOwner && (
        <CreateChannel />
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {channels.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">No channels yet</p>
        ) : (
          channels.map(channel => {
            const isActiveVoice = channel.type === "voice" && activeVoiceChannelId === channel.id;
            const isActiveText = channel.type === "text" && channelId === channel.id;
            const roomInfo = channel.type === "voice"
              ? roomList.find(r => r.id === channel.id)
              : null;
            const occupantCount = roomInfo?.userCount ?? 0;

            return (
              <div key={channel.id}>
                <button
                  onClick={() => onChannelClick(channel)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                    isActiveVoice || isActiveText
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {channel.type === "voice"
                    ? <Volume2 className="h-4 w-4 shrink-0" />
                    : <Hash className="h-4 w-4 shrink-0" />
                  }
                  <span className="truncate flex-1 text-left">{channel.name}</span>
                  {channel.type === "voice" && occupantCount > 0 && !isActiveVoice && (
                    <span className="text-[10px] text-muted-foreground/70 shrink-0">
                      {occupantCount}
                    </span>
                  )}
                </button>

                {channel.type === "voice" && isActiveVoice && (
                  <div className="ml-4 mt-0.5">
                    <MembersList />
                  </div>
                )}

                {channel.type === "voice" && !isActiveVoice && occupantCount > 0 && (
                  <p className="ml-8 text-[11px] text-muted-foreground/50 pb-0.5">
                    {occupantCount} connected
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>

      <VoicePanel />

      <div className="p-3 border-t space-y-2">
        {ephem.active ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-muted-foreground">Ephemeral chat active</span>
              {ephem.timeLeft && (
                <span className="ml-auto font-mono text-[11px] text-amber-400/70">
                  {ephem.timeLeft}
                </span>
              )}
            </div>
            {!ephem.joined ? (
              <Button
                size="sm"
                className="w-full gap-2"
                onClick={ephem.join}
                disabled={!isConnected}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Join chat
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="w-full gap-2"
                onClick={() => ephem.setOpen(true)}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Open chat
              </Button>
            )}
            {ephem.joined && (
              <Button
                size="sm"
                variant="ghost"
                className="w-full text-xs text-destructive hover:text-destructive"
                onClick={ephem.end}
              >
                End ephemeral chat
              </Button>
            )}
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="w-full gap-2"
            onClick={ephem.start}
            disabled={!isConnected}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Start ephemeral chat
          </Button>
        )}
      </div>
    </div>
  );
}