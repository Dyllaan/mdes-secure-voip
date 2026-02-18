import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Send } from "lucide-react";
import { useRef, useEffect } from "react";
import type { ChatMessage } from "@/types/voip.types";
import { useAuth } from "@/hooks/useAuth";

interface ChatTabProps {
    messages: ChatMessage[];
    message: string;
    setMessage: (message: string) => void;
    sendMessage: () => void;
}

const ChatTab = ({ messages, message, setMessage, sendMessage }: ChatTabProps) => {
    const { user } = useAuth();
    const inputRef = useRef<HTMLInputElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            sendMessage();
        }
    };

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const isMyMessage = (msg: ChatMessage) => {
        return msg.sender === "me" || msg.sender === user?.username;
    };

    return (
        <div className="flex flex-col h-full w-full gap-4 p-6 bg-background rounded-xl border shadow-lg overflow-hidden">
            {/* Chat Display */}
            <div className="flex-1 overflow-y-auto bg-muted/50 p-4 rounded-lg border space-y-3">
                {messages.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                        <p className="text-muted-foreground text-center italic">
                            No messages yet.
                        </p>
                    </div>
                ) : (
                    <>
                        {messages.map((msg, index) => {
                            const isMine = isMyMessage(msg);
                            
                            return (
                                <div
                                    key={index}
                                    className={`flex ${
                                        isMine ? "justify-end" : "justify-start"
                                    } animate-in fade-in slide-in-from-bottom-2 duration-300`}
                                >
                                    <div
                                        className={`${
                                            isMine
                                                ? "bg-primary text-primary-foreground"
                                                : "bg-muted text-foreground border"
                                        } px-4 py-2.5 rounded-2xl min-w-[50%] max-w-[75%] shadow-lg hover:shadow-xl transition-all duration-200`}
                                    >
                                        {!isMine && (
                                            <p className="font-semibold text-xs mb-1 opacity-90">
                                                {msg.alias || msg.sender || "Peer"}
                                            </p>
                                        )}
                                        <p className="text-sm leading-relaxed">{msg.message}</p>
                                    </div>
                                </div>
                            );
                        })}
                        <div ref={messagesEndRef} />
                    </>
                )}
            </div>

            <Separator />

            {/* Input Section */}
            <div className="flex gap-3 items-center w-full">
                <Input
                    ref={inputRef}
                    className="flex-1"
                    placeholder="Type a message..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyPress={handleKeyPress}
                />
                <Button
                    onClick={sendMessage}
                    size="icon"
                    className="rounded-full hover:scale-105 active:scale-95 transition-all duration-200"
                    aria-label="Send message"
                >
                    <Send className="h-5 w-5" />
                </Button>
            </div>
        </div>
    );
};

export default ChatTab;