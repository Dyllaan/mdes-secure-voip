import AudioSettings from "../voip/AudioSettings";
import type { SimpleNoiseGate } from "@/utils/SimpleNoiseGate";
import { Button } from "../ui/button";
import { useAuth } from "@/hooks/useAuth";

export default function SettingsTab({ noiseGate }: { noiseGate: SimpleNoiseGate | null }) {
    
    const { logout } = useAuth();

    return (
        <div className="flex flex-col gap-4">
            <AudioSettings noiseGate={noiseGate} />
            <Button onClick={() => {
                logout();
            }}>
                Logout
            </Button>
        </div>
    );
}