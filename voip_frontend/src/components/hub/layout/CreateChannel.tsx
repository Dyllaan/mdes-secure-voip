import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Hash, Volume2, Plus } from "lucide-react";
import { useHubLayout } from "@/contexts/HubLayoutContext";
import { useMemo, useState } from "react";
import Validator from "@/utils/validation/Validator";
import useHubApi from "@/hooks/hub/useHubApi";
import { toast } from "sonner";

export default function CreateChannel() {
    const [newChannelName, setNewChannelName] = useState('');
    const [newChannelType, setNewChannelType] = useState<'text' | 'voice'>('text');
    const { hub, socket, refreshChannels } = useHubLayout();
    const { createChannel } = useHubApi();

    const onNewChannelTypeToggle = () => {
        setNewChannelType(prev => prev === 'text' ? 'voice' : 'text');
    }

    const validator = useMemo(() => new Validator(), []);

    const channelValidation = useMemo(
          () => validator.validate('Channel', newChannelName),
          [validator, newChannelName]
      );
    const onCreateChannel = async () => {
        if (!hub?.id || !channelValidation.valid || !channelValidation.value) return;

        try {
            const created = await createChannel(hub.id, channelValidation.value, newChannelType);

            setNewChannelName('');
            setNewChannelType('text');
            await refreshChannels();

            if (created.id) {
                socket?.emit('channel-created', { hubId: hub.id, channelId: created.id });
            }
        } catch {
            toast.error('Failed to create channel');
        }
    };

    return (
        <div className="p-3 border-b">
          <div className="flex gap-1">
            <div className="flex-1">
              <label htmlFor="create-channel-input" className="sr-only">
                New channel name
              </label>
              <Input
                id="create-channel-input"
                data-testid="create-channel-input"
                placeholder="New channel..."
                value={newChannelName}
                onChange={e => setNewChannelName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && onCreateChannel()}
                className="h-8 text-xs"
              />
            </div>
            <button
              data-testid="create-channel-type-toggle"
              onClick={onNewChannelTypeToggle}
              className="h-8 px-2 rounded-md border text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              title={`Type: ${newChannelType}`}
              aria-label={`Channel type: ${newChannelType}. Activate to switch to ${newChannelType === 'text' ? 'voice' : 'text'}.`}
              type="button"
            >
              {newChannelType === "text"
                ? <Hash className="h-3 w-3" />
                : <Volume2 className="h-3 w-3" />
              }
            </button>
            <Button
              data-testid="create-channel-submit"
              size="sm"
              className="h-8 px-2"
              onClick={onCreateChannel}
              disabled={!newChannelName.trim()}
              aria-label="Create channel"
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>
    );
}
