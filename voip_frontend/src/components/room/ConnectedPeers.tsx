import { useEffect, useState } from "react";
import Avatar from "@/components/voip/Avatar";
import { Slider } from "@/components/ui/slider";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Peer {
    peerId: string;
    alias: string;
}

interface ConnectedPeersProps {
    setPeerVolumes: (volumes: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => void;
    connectedPeers: Peer[];
}

const ConnectedPeers = ({ setPeerVolumes, connectedPeers }: ConnectedPeersProps) => {
    const [peerColors, setPeerColors] = useState<Record<string, string>>({});

    useEffect(() => {
        connectedPeers.forEach(({ peerId }) => assignColor(peerId));
    }, [connectedPeers]);

    const assignColor = (peerId: string) => {
        setPeerColors((prev) => {
            if (prev[peerId]) return prev;
            return { ...prev, [peerId]: `hsl(${Math.random() * 360}, 100%, 50%)` };
        });
    };

    return (
        <div className="p-4 border rounded-lg">
            {connectedPeers.length > 0 ? (
                <div className="flex gap-2">
                    {connectedPeers.map(({ peerId, alias }) => (
                        <DropdownMenu key={peerId}>
                            <DropdownMenuTrigger asChild>
                                <div className="flex flex-col items-center text-center mx-2 gap-2 cursor-pointer">
                                    <Avatar color={peerColors[peerId]} />
                                    <p className="mt-2 text-sm font-bold">
                                        {alias}
                                    </p>
                                </div>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                                <div className="p-4 w-64">
                                    <Slider
                                        defaultValue={[40]}
                                        max={100}
                                        step={1}
                                        onValueChange={(value) => {
                                            const percentageValue = value[0] / 100;
                                            setPeerVolumes((prev) => ({ ...prev, [peerId]: percentageValue }));
                                        }}
                                        className="w-full"
                                    />
                                    <div className="flex justify-between mt-2 text-xs text-muted-foreground">
                                        <span>0%</span>
                                        <span>50%</span>
                                        <span>100%</span>
                                    </div>
                                </div>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    ))}
                </div>
            ) : (
                <h4 className="text-gray-500 font-semibold">
                    No peers connected
                </h4>
            )}
        </div>
    );
};

export default ConnectedPeers;