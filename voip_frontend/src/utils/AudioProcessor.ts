// src/utils/audioProcessor.ts

export default class AudioProcessor {
    private audioContext: AudioContext;
    private sourceNode: MediaStreamAudioSourceNode | null = null;
    private gainNode: GainNode;
    private compressorNode: DynamicsCompressorNode;
    private filterNode: BiquadFilterNode;
    private noiseGateNode: AudioWorkletNode | null = null;
    private destination: MediaStreamAudioDestinationNode;
    private analyser: AnalyserNode;

    constructor() {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        this.audioContext = new AudioContextClass();

        // Create audio processing nodes
        this.gainNode = this.audioContext.createGain();
        this.compressorNode = this.audioContext.createDynamicsCompressor();
        this.filterNode = this.audioContext.createBiquadFilter();
        this.analyser = this.audioContext.createAnalyser();
        this.destination = this.audioContext.createMediaStreamDestination();

        this.setupAudioChain();
    }

    private setupAudioChain() {
        // Configure compressor (reduces dynamic range, evens out volume)
        this.compressorNode.threshold.value = -30; // Reduced from -50 for better click suppression
        this.compressorNode.knee.value = 30;
        this.compressorNode.ratio.value = 8; // Reduced from 12 for more natural sound
        this.compressorNode.attack.value = 0.001; // Faster attack to catch clicks
        this.compressorNode.release.value = 0.1; // Faster release

        // Configure high-pass filter (removes low-frequency rumble/noise AND some clicks)
        this.filterNode.type = 'highpass';
        this.filterNode.frequency.value = 100; // Increased from 85 to remove more noise
        this.filterNode.Q.value = 0.7; // Lower Q for smoother rolloff

        // Configure gain (overall volume control)
        this.gainNode.gain.value = 1.0; // Start at normal volume

        // Configure analyser for visualization (optional)
        this.analyser.fftSize = 2048;
    }

    async processStream(originalStream: MediaStream): Promise<MediaStream> {
        // Get audio track with MAXIMUM noise suppression
        const constraints: MediaTrackConstraints = {
            echoCancellation: { ideal: true },
            noiseSuppression: { ideal: true },
            autoGainControl: { ideal: true },
            sampleRate: 48000,
            channelCount: 1, // Mono for VoIP
        };

        try {
            // Request a new stream with constraints
            const enhancedStream = await navigator.mediaDevices.getUserMedia({
                audio: constraints
            });

            // Create source from the enhanced stream
            this.sourceNode = this.audioContext.createMediaStreamSource(enhancedStream);

            // Try to load noise gate worklet (advanced feature)
            try {
                await this.loadNoiseGate();
            } catch (err) {
                console.log('Noise gate not available, using basic processing');
            }

            // Connect the processing chain
            if (this.noiseGateNode) {
                // With noise gate: Source -> Filter -> NoiseGate -> Compressor -> Gain -> Destination
                this.sourceNode
                    .connect(this.filterNode)
                    .connect(this.noiseGateNode)
                    .connect(this.compressorNode)
                    .connect(this.gainNode)
                    .connect(this.analyser)
                    .connect(this.destination);
            } else {
                // Without noise gate: Source -> Filter -> Compressor -> Gain -> Destination
                this.sourceNode
                    .connect(this.filterNode)
                    .connect(this.compressorNode)
                    .connect(this.gainNode)
                    .connect(this.analyser)
                    .connect(this.destination);
            }

            // Return the processed stream
            return this.destination.stream;

        } catch (error) {
            console.error('Failed to apply audio processing, falling back to original stream:', error);
            return originalStream;
        }
    }

    private async loadNoiseGate() {
        // Create a simple noise gate processor inline
        const noiseGateCode = `
class NoiseGateProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.threshold = 0.01; // Threshold below which audio is cut
        this.port.onmessage = (e) => {
            if (e.data.threshold !== undefined) {
                this.threshold = e.data.threshold;
            }
        };
    }

    process(inputs, outputs) {
        const input = inputs[0];
        const output = outputs[0];

        if (input.length > 0) {
            for (let channel = 0; channel < input.length; channel++) {
                const inputChannel = input[channel];
                const outputChannel = output[channel];
                
                for (let i = 0; i < inputChannel.length; i++) {
                    // If signal is below threshold, mute it (removes clicks and background noise)
                    if (Math.abs(inputChannel[i]) < this.threshold) {
                        outputChannel[i] = 0;
                    } else {
                        outputChannel[i] = inputChannel[i];
                    }
                }
            }
        }

        return true;
    }
}

registerProcessor('noise-gate-processor', NoiseGateProcessor);
        `;

        // Create blob and load worklet
        const blob = new Blob([noiseGateCode], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);

        try {
            await this.audioContext.audioWorklet.addModule(url);
            this.noiseGateNode = new AudioWorkletNode(this.audioContext, 'noise-gate-processor');
            console.log('Noise gate loaded successfully');
        } catch (err) {
            console.warn('Could not load noise gate:', err);
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    updateGain(value: number) {
        this.gainNode.gain.value = value;
    }

    updateFilterFrequency(value: number) {
        this.filterNode.frequency.value = value;
    }

    updateNoiseGateThreshold(value: number) {
        if (this.noiseGateNode) {
            this.noiseGateNode.port.postMessage({ threshold: value });
        }
    }

    async resume() {
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
    }

    cleanup() {
        if (this.sourceNode) {
            this.sourceNode.disconnect();
        }
        this.filterNode.disconnect();
        this.compressorNode.disconnect();
        this.gainNode.disconnect();
        this.analyser.disconnect();
        if (this.noiseGateNode) {
            this.noiseGateNode.disconnect();
        }
        this.audioContext.close();
    }
}