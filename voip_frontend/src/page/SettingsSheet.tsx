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
    SheetTrigger,
} from "@/components/ui/sheet";
import { Settings } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsTab({ noiseGate }: { noiseGate: SimpleNoiseGate | null }) {
    const { logout } = useAuth();

    return (
        <Sheet>
            <SheetTrigger asChild>
                <Button variant="ghost" size="icon">
                    <Settings className="h-5 w-5" />
                </Button>
            </SheetTrigger>
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