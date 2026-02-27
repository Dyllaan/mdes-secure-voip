import { useState, useEffect } from "react";
import { Slider } from "@/components/ui/slider";
import { SimpleNoiseGate } from "@/utils/SimpleNoiseGate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Mic, Volume2, Filter } from "lucide-react";

interface AudioSettingsProps {
    noiseGate: SimpleNoiseGate | null;
}

const AudioSettings = ({ noiseGate }: AudioSettingsProps) => {
    const [threshold, setThreshold] = useState(10); // Default 0.01
    const [audioLevel, setAudioLevel] = useState(0);

    useEffect(() => {
        if (!noiseGate) return;

        const interval = setInterval(() => {
            const level = noiseGate.getCurrentLevel();
            setAudioLevel(level);
        }, 100);

        return () => clearInterval(interval);
    }, [noiseGate]);

    if (!noiseGate) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Mic className="h-5 w-5" />
                        Audio Settings
                    </CardTitle>
                    <CardDescription>Loading audio processor...</CardDescription>
                </CardHeader>
            </Card>
        );
    }

    const isGateOpen = audioLevel > threshold / 1000;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Mic className="h-5 w-5" />
                    Audio Settings
                </CardTitle>
                <CardDescription>
                    Reduce keyboard clicks and background noise
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Audio Level Meter */}
                <div className="space-y-2">
                    <div className="flex justify-between items-center">
                        <label className="text-sm font-medium flex items-center gap-2">
                            <Volume2 className="h-4 w-4" />
                            Input Level
                        </label>
                        <span className={`text-xs font-mono ${isGateOpen ? 'text-green-600' : 'text-red-600'}`}>
                            {isGateOpen ? '🟢 OPEN' : ' CLOSED'}
                        </span>
                    </div>
                    
                    {/* Visual meter */}
                    <div className="h-8 bg-gray-200 dark:bg-gray-800 rounded-lg overflow-hidden relative">
                        <div 
                            className="h-full bg-gradient-to-r from-green-500 via-yellow-500 to-red-500 transition-all duration-100"
                            style={{ width: `${Math.min(audioLevel * 1000, 100)}%` }}
                        />
                        {/* Threshold indicator line */}
                        <div 
                            className="absolute top-0 bottom-0 w-0.5 bg-blue-600"
                            style={{ left: `${Math.min(threshold, 100)}%` }}
                        >
                            <div className="absolute -top-1 -left-2 w-4 h-4 bg-blue-600 rounded-full border-2 border-white" />
                        </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        The blue marker shows your threshold. Sound below it is cut.
                    </p>
                </div>

                {/* Noise Gate Threshold */}
                <div className="space-y-2">
                    <div className="flex justify-between items-center">
                        <label className="text-sm font-medium flex items-center gap-2">
                            <Filter className="h-4 w-4" />
                            Noise Gate Threshold
                        </label>
                        <span className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                            {threshold}
                        </span>
                    </div>
                    <Slider
                        value={[threshold]}
                        min={1}
                        max={50}
                        step={1}
                        onValueChange={(value) => {
                            setThreshold(value[0]);
                            noiseGate.setThreshold(value[0] / 1000);
                        }}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                        <span>1 (Sensitive)</span>
                        <span>25 (Balanced)</span>
                        <span>50 (Aggressive)</span>
                    </div>
                </div>

                {/* Presets */}
                <div className="space-y-2">
                    <label className="text-sm font-medium">Quick Presets</label>
                    <div className="grid grid-cols-3 gap-2">
                        <button
                            onClick={() => {
                                setThreshold(5);
                                noiseGate.setThreshold(0.005);
                            }}
                            className="px-3 py-2 text-xs border rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        >
                            Light
                            <div className="text-[10px] text-muted-foreground">Quiet room</div>
                        </button>
                        <button
                            onClick={() => {
                                setThreshold(15);
                                noiseGate.setThreshold(0.015);
                            }}
                            className="px-3 py-2 text-xs border rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        >
                            Medium
                            <div className="text-[10px] text-muted-foreground">Normal use</div>
                        </button>
                        <button
                            onClick={() => {
                                setThreshold(30);
                                noiseGate.setThreshold(0.030);
                            }}
                            className="px-3 py-2 text-xs border rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        >
                            Heavy
                            <div className="text-[10px] text-muted-foreground">Noisy room</div>
                        </button>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

export default AudioSettings;