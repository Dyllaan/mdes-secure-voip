// src/utils/simpleNoiseGate.ts

export class SimpleNoiseGate {
    private audioContext: AudioContext;
    private sourceNode: MediaStreamAudioSourceNode | null = null;
    private workletNode: AudioWorkletNode | null = null;
    private destination: MediaStreamAudioDestinationNode;
    private currentLevel: number = 0;

    constructor() {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        this.audioContext = new AudioContextClass();
        this.destination = this.audioContext.createMediaStreamDestination();
    }

    async processStream(inputStream: MediaStream): Promise<MediaStream> {
        try {
            await this.loadNoiseGateWorklet();

            this.sourceNode = this.audioContext.createMediaStreamSource(inputStream);
            
            if (this.workletNode) {
                // Listen for level updates from the worklet
                this.workletNode.port.onmessage = (e) => {
                    if (e.data.level !== undefined) {
                        this.currentLevel = e.data.level;
                    }
                };

                this.sourceNode.connect(this.workletNode);
                this.workletNode.connect(this.destination);
                
                console.log('Simple noise gate active (AudioWorklet)');
            } else {
                this.sourceNode.connect(this.destination);
                console.warn('️ Noise gate worklet failed, audio will pass through unprocessed');
            }
            
            return this.destination.stream;
            
        } catch (error) {
            console.error('Failed to apply noise gate:', error);
            return inputStream;
        }
    }

    private async loadNoiseGateWorklet() {
        const workletCode = `
class NoiseGateProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.threshold = 0.01;
        this.smoothingFactor = 0.95;
        this.currentRMS = 0;
        this.frameCount = 0;
        
        this.port.onmessage = (e) => {
            if (e.data.threshold !== undefined) {
                this.threshold = e.data.threshold;
            }
        };
    }

    process(inputs, outputs) {
        const input = inputs[0];
        const output = outputs[0];

        if (input.length > 0 && input[0].length > 0) {
            const inputChannel = input[0];
            const outputChannel = output[0];
            
            // Calculate RMS (Root Mean Square)
            let sum = 0;
            for (let i = 0; i < inputChannel.length; i++) {
                sum += inputChannel[i] * inputChannel[i];
            }
            const rms = Math.sqrt(sum / inputChannel.length);
            
            // Smooth the RMS
            this.currentRMS = (this.smoothingFactor * this.currentRMS) + ((1 - this.smoothingFactor) * rms);
            
            // Send level update every 10 frames (~100ms at 48kHz)
            this.frameCount++;
            if (this.frameCount % 10 === 0) {
                this.port.postMessage({ level: this.currentRMS });
            }
            
            // Apply noise gate
            if (this.currentRMS > this.threshold) {
                // Signal is above threshold - pass through
                for (let i = 0; i < inputChannel.length; i++) {
                    outputChannel[i] = inputChannel[i];
                }
            } else {
                // Signal is below threshold - mute
                for (let i = 0; i < inputChannel.length; i++) {
                    outputChannel[i] = 0;
                }
            }
        }

        return true;
    }
}

registerProcessor('noise-gate-processor', NoiseGateProcessor);
        `;

        try {
            const blob = new Blob([workletCode], { type: 'application/javascript' });
            const url = URL.createObjectURL(blob);

            await this.audioContext.audioWorklet.addModule(url);
            this.workletNode = new AudioWorkletNode(this.audioContext, 'noise-gate-processor');
            
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Could not load noise gate worklet:', err);
        }
    }

    setThreshold(value: number) {
        if (this.workletNode) {
            this.workletNode.port.postMessage({ threshold: value });
            console.log('Noise gate threshold:', value);
        }
    }

    getCurrentLevel(): number {
        return this.currentLevel;
    }

    async resume() {
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
    }

    cleanup() {
        if (this.workletNode) {
            this.workletNode.disconnect();
            this.workletNode = null;
        }
        if (this.sourceNode) {
            this.sourceNode.disconnect();
        }
        this.audioContext.close();
    }
}