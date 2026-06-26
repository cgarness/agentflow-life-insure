/**
 * Browser audio for the AI Testing lab. Captures the mic and plays the agent's
 * voice using the same wire format as the phone path: G.711 µ-law, 8 kHz, mono,
 * base64-encoded frames. This lets the Render bridge reuse its existing Twilio
 * upstream configuration unchanged.
 */

import type { BackgroundSound } from "@/lib/aiTestingFormSchema";

const TARGET_SAMPLE_RATE = 8000;
const DEFAULT_JITTER_BUFFER_MS = 180;

/** Mic defaults used by Inworld/OpenAI browser tests (unchanged legacy behavior). */
const LEGACY_MIC_DEFAULTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

function linearToMulaw(sample: number): number {
  const BIAS = 0x84;
  const CLIP = 32635;
  const sign = (sample >> 8) & 0x80;
  if (sign !== 0) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {
    // find exponent
  }
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

function mulawToLinear(mulawByte: number): number {
  const inverted = ~mulawByte;
  const sign = inverted & 0x80;
  const exponent = (inverted >> 4) & 0x07;
  const mantissa = inverted & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return sign !== 0 ? -sample : sample;
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function bytesFromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Average-decimate a Float32 buffer from inputRate down to 8 kHz. */
function downsampleTo8k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === TARGET_SAMPLE_RATE) return input;
  const ratio = inputRate / TARGET_SAMPLE_RATE;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      sum += input[j];
      count++;
    }
    out[i] = count > 0 ? sum / count : 0;
  }
  return out;
}

export type BrowserAudioCallbacks = {
  onChunk: (base64Mulaw: string) => void;
  onError?: (message: string) => void;
};

export type BrowserAudioStartConfig = BrowserAudioCallbacks & {
  playbackJitterBufferMs?: number;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  backgroundSound?: BackgroundSound;
  backgroundVolume?: number;
};

type AmbientNodes = {
  source: AudioBufferSourceNode;
  lfo: OscillatorNode;
  gain: GainNode;
};

/**
 * Owns the mic capture pipeline and the agent playback queue for one test
 * session. Mic float frames are downsampled to 8 kHz and µ-law encoded; agent
 * µ-law frames are decoded and scheduled with a small jitter buffer.
 */
export class BrowserAudioSession {
  private micStream: MediaStream | null = null;
  private captureCtx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private playbackCtx: AudioContext | null = null;
  private playheadAt = 0;
  private jitterBufferSec = DEFAULT_JITTER_BUFFER_MS / 1000;
  private activeSources: AudioBufferSourceNode[] = [];
  private ambient: AmbientNodes | null = null;

  async start(config: BrowserAudioStartConfig): Promise<void> {
    const mic = {
      echoCancellation: config.echoCancellation ?? LEGACY_MIC_DEFAULTS.echoCancellation,
      noiseSuppression: config.noiseSuppression ?? LEGACY_MIC_DEFAULTS.noiseSuppression,
      autoGainControl: config.autoGainControl ?? LEGACY_MIC_DEFAULTS.autoGainControl,
    };
    this.jitterBufferSec = (config.playbackJitterBufferMs ?? DEFAULT_JITTER_BUFFER_MS) / 1000;

    this.micStream = await navigator.mediaDevices.getUserMedia({ audio: mic });

    const AudioCtor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    this.captureCtx = new AudioCtor();
    this.playbackCtx = new AudioCtor();
    await this.captureCtx.resume();
    await this.playbackCtx.resume();

    if (config.backgroundSound === "light_office") {
      this.startAmbient(config.backgroundVolume ?? 0.06);
    }

    this.source = this.captureCtx.createMediaStreamSource(this.micStream);
    this.processor = this.captureCtx.createScriptProcessor(4096, 1, 1);
    const inputRate = this.captureCtx.sampleRate;

    this.processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const down = downsampleTo8k(input, inputRate);
      const mulaw = new Uint8Array(down.length);
      for (let i = 0; i < down.length; i++) {
        const clamped = Math.max(-1, Math.min(1, down[i]));
        mulaw[i] = linearToMulaw(Math.round(clamped * 32767));
      }
      try {
        config.onChunk(base64FromBytes(mulaw));
      } catch (err) {
        config.onError?.(err instanceof Error ? err.message : String(err));
      }
    };

    this.source.connect(this.processor);
    this.processor.connect(this.captureCtx.destination);
  }

  /** Update ambient bed volume (0–0.15) during an active session. */
  setBackgroundVolume(volume: number): void {
    if (this.ambient) {
      this.ambient.gain.gain.value = Math.max(0, Math.min(0.15, volume));
    }
  }

  private startAmbient(volume: number): void {
    if (!this.playbackCtx) return;
    const ctx = this.playbackCtx;
    const bufferSize = 2 * ctx.sampleRate;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      data[i] = (b0 + b1 + b2) * 0.12;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 450;

    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(0.15, volume));

    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.12;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.015;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    source.start();
    lfo.start();
    this.ambient = { source, lfo, gain };
  }

  private stopAmbient(): void {
    if (!this.ambient) return;
    try {
      this.ambient.source.stop();
    } catch {
      // already stopped
    }
    try {
      this.ambient.lfo.stop();
    } catch {
      // already stopped
    }
    this.ambient = null;
  }

  /** Decode an incoming µ-law frame and schedule it with a jitter buffer. */
  play(base64Mulaw: string): void {
    if (!this.playbackCtx) return;
    const mulaw = bytesFromBase64(base64Mulaw);
    if (mulaw.length === 0) return;

    const buffer = this.playbackCtx.createBuffer(1, mulaw.length, TARGET_SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < mulaw.length; i++) channel[i] = mulawToLinear(mulaw[i]) / 32768;

    const node = this.playbackCtx.createBufferSource();
    node.buffer = buffer;
    node.connect(this.playbackCtx.destination);

    const now = this.playbackCtx.currentTime;
    if (this.playheadAt < now) {
      this.playheadAt = now + this.jitterBufferSec;
    }
    const startAt = Math.max(now, this.playheadAt);
    node.start(startAt);
    this.playheadAt = startAt + buffer.duration;

    this.activeSources.push(node);
    node.onended = () => {
      this.activeSources = this.activeSources.filter((s) => s !== node);
    };
  }

  /** Barge-in: stop any queued agent audio immediately. */
  clearPlayback(): void {
    for (const node of this.activeSources) {
      try {
        node.stop();
      } catch {
        // already stopped
      }
    }
    this.activeSources = [];
    this.playheadAt = this.playbackCtx?.currentTime ?? 0;
  }

  stop(): void {
    this.clearPlayback();
    this.stopAmbient();
    if (this.processor) {
      this.processor.onaudioprocess = null;
      try {
        this.processor.disconnect();
      } catch {
        // ignore
      }
    }
    try {
      this.source?.disconnect();
    } catch {
      // ignore
    }
    this.micStream?.getTracks().forEach((track) => track.stop());
    void this.captureCtx?.close().catch(() => undefined);
    void this.playbackCtx?.close().catch(() => undefined);
    this.micStream = null;
    this.captureCtx = null;
    this.playbackCtx = null;
    this.processor = null;
    this.source = null;
  }
}
