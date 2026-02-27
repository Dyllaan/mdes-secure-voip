import AudioSettings from "@/components/voip/AudioSettings";
import type { SimpleNoiseGate } from "@/utils/SimpleNoiseGate";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import ThemeToggle from "@/components/theme/ThemeToggle";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface SettingsTabProps {
    noiseGate: SimpleNoiseGate | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export default function SettingsTab({ noiseGate, open, onOpenChange }: SettingsTabProps) {
    const { logout } = useAuth();
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent>
                <SheetHeader>
                    <SheetTitle>Settings</SheetTitle>
                </SheetHeader>
                <div className="flex flex-col gap-4 p-4">
                    <AudioSettings noiseGate={noiseGate} />
                    <Card>
                        <CardHeader>
                            <CardTitle>Theme</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ThemeToggle />
                        </CardContent>
                    </Card>
                    <Button onClick={() => logout()}>
                        Logout
                    </Button>
                </div>
            </SheetContent>
        </Sheet>
    );
}