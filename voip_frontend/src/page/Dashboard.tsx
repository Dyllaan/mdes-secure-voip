import useVoIP from "../hooks/useVoIP";
import { useState } from "react";
import Header from "../components/layout/Header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SettingsTab from "../components/tab/SettingsTab";
import ChatTab from "../components/tab/ChatTab";

const Dashboard = () => {
    const { chatMessages, message, setMessage, sendMessage, remoteStreams, localAudioRef, socket, noiseGate} = useVoIP();
    const [peerVolumes, setPeerVolumes] = useState<Record<string, number>>({});

    return (
        <div className="flex flex-col gap-4">
            <Header 
                setPeerVolumes={setPeerVolumes} 
                peerVolumes={peerVolumes} 
                socket={socket} 
                remoteStreams={remoteStreams}
                localAudioRef={localAudioRef}
            />
            <div className="gap-4 max-w-4xl w-full mx-auto p-4">
            <Tabs defaultValue="media" className="w-full">
                <TabsList>
                    <TabsTrigger value="media">Media</TabsTrigger>
                    <TabsTrigger value="chat">Chat</TabsTrigger>
                    <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>
                <TabsContent value="media">Media</TabsContent>
                <TabsContent value="chat"><ChatTab messages={chatMessages} message={message} setMessage={setMessage} sendMessage={sendMessage} /></TabsContent>
                <TabsContent value="settings"><SettingsTab noiseGate={noiseGate} /></TabsContent>
            </Tabs>
            </div>
        </div>
    );
};

export default Dashboard;