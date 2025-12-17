import { useEffect, useState } from "react";
import Avatar from "./Avatar";
import { Slider } from "@/components/ui/slider";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Socket } from "socket.io-client";

interface Peer {
    peerId: string;
    alias: string;
}

interface ConnectedPeersProps {
    socket: Socket | null;
    setPeerVolumes: (volumes: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => void;
}

const ConnectedPeers = ({ socket, setPeerVolumes }: ConnectedPeersProps) => {
    const [connectedPeers, setConnectedPeers] = useState<Peer[]>([]);
    const [peerColors, setPeerColors] = useState<Record<string, string>>({});

    useEffect(() => {
        console.log(connectedPeers);
    }, [connectedPeers]);

    const assignColor = (peerId: string) => {
        setPeerColors((prev) => {
            if (prev[peerId]) return prev;
            return { ...prev, [peerId]: `hsl(${Math.random() * 360}, 100%, 50%)` };
        });
    };

    useEffect(() => {
        if (!socket) return;

        const handleAllUsers = (peers: Peer[]) => {
            peers.forEach(({ peerId }) => assignColor(peerId));
            setConnectedPeers(peers);
        };

        const handleUserConnected = ({ peerId, alias }: { peerId: string; alias?: string }) => {
            assignColor(peerId);
            setConnectedPeers((prev) => [
                ...prev.filter((p) => p.peerId !== peerId),
                { peerId, alias: alias || "Unknown" }
            ]);
        };

        const handleUserDisconnected = (peerId: string) => {
            setConnectedPeers((prev) => prev.filter((p) => p.peerId !== peerId));
        };

        const handleAliasUpdated = ({ peerId, alias }: { peerId: string; alias: string }) => {
            setConnectedPeers((prev) => prev.map((p) => p.peerId === peerId ? { ...p, alias } : p));
        };

        socket.on("all-users", handleAllUsers);
        socket.on("user-connected", handleUserConnected);
        socket.on("user-disconnected", handleUserDisconnected);
        socket.on("alias-updated", handleAliasUpdated);

        return () => {
            socket.off("all-users", handleAllUsers);
            socket.off("user-connected", handleUserConnected);
            socket.off("user-disconnected", handleUserDisconnected);
            socket.off("alias-updated", handleAliasUpdated);
        };
    }, [socket]);

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
                <h4 className="text-gray-700 font-semibold">
                    No peers connected
                </h4>
            )}
        </div>
    );
};

export default ConnectedPeers;