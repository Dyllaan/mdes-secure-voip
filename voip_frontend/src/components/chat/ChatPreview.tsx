import { useState, useEffect } from "react";
import type { ChatMessage } from "@/types/voip.types";

interface ChatPreviewProps {
    message: ChatMessage | null;
    isVisible: boolean;
}

const ChatPreview = ({ message, isVisible }: ChatPreviewProps) => {
    const [show, setShow] = useState(false);

    useEffect(() => {
        if (isVisible) {
            setShow(true);
        } else {
            setTimeout(() => setShow(false), 300);
        }
    }, [isVisible]);

    if (!message || !show) return null;

    return (
        <div
            className={`text-white py-2 px-4 max-w-full transition-all duration-300 ease-in-out ${
                isVisible
                    ? "opacity-100 translate-y-0"
                    : "opacity-0 -translate-y-2.5"
            }`}
        >
            <p className="font-bold">
                {message.sender === "me" ? "You" : "Peer"}
            </p>
            <p>{message.message}</p>
        </div>
    );
};

export default ChatPreview;