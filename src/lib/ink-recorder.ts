import { inkTranscript, VOICE_SECONDS } from "./pilot-composer.ts";

export type VoiceState = "idle" | "connecting" | "recording" | "finishing";
type VoiceToken = {
  token: string;
  version: string;
  model: string;
  maxSeconds: number;
};
type RecorderOptions = {
  token: () => Promise<VoiceToken>;
  state: (state: VoiceState) => void;
  partial: (text: string) => void;
  complete: (text: string) => void;
  error: (message: string, recovered: string) => void;
  level: (level: number) => void;
};

// Buffer real microphone samples into ~100ms frames. A stop message flushes
// the tail before the main thread sends finalize; there is no synthetic audio.
const workletSource = `
class ForkNightCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.samples=[]; this.active=true;
    this.port.onmessage=({data})=>{if(data==='stop'){this.active=false;this.flush();this.port.postMessage({flushed:true});}};
  }
  flush(){if(!this.samples.length)return;const chunk=new Float32Array(this.samples);this.samples=[];this.port.postMessage({samples:chunk},[chunk.buffer]);}
  process(inputs){if(!this.active)return false;const input=inputs[0]?.[0];if(input){for(const sample of input)this.samples.push(sample);if(this.samples.length>=sampleRate/10)this.flush();}return true;}
}
registerProcessor('fork-night-capture',ForkNightCapture);
`;

/** One hold/tap session. All exits release the mic, audio context and socket.
 * Nothing reconnects or buys another token automatically. */
export function createInkRecorder(options: RecorderOptions) {
  let phase: VoiceState = "idle",
    cancelled = false,
    ended = false,
    finishSent = false;
  let stream: MediaStream | undefined, context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined,
    capture: AudioWorkletNode | undefined;
  let socket: WebSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined,
    drainTimer: ReturnType<typeof setTimeout> | undefined;
  let transcript = { final: "", interim: "" };
  const setPhase = (next: VoiceState) => {
    phase = next;
    options.state(next);
  };
  function releaseAudio() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = undefined;
    source?.disconnect();
    source = undefined;
    capture?.disconnect();
    capture = undefined;
    if (context && context.state !== "closed")
      void context.close().catch(() => {});
    context = undefined;
    options.level(0);
  }
  function clean() {
    clearTimeout(timer);
    clearTimeout(drainTimer);
    releaseAudio();
    if (socket) {
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      )
        socket.close();
      socket = undefined;
    }
    setPhase("idle");
  }
  function fail(message: string) {
    if (ended || cancelled) return;
    ended = true;
    clean();
    options.error(message, transcript.final.trim());
  }
  function complete() {
    if (ended || cancelled) return;
    ended = true;
    const text = transcript.final.trim();
    clean();
    if (text) options.complete(text);
    else
      options.error(
        "I didn’t catch any words. Try again, or type your thought.",
        "",
      );
  }
  function finalize() {
    if (finishSent || cancelled || ended) return;
    finishSent = true;
    releaseAudio();
    if (socket?.readyState !== WebSocket.OPEN) {
      fail("The voice connection ended. Your draft is still here.");
      return;
    }
    socket.send("finalize");
    clearTimeout(drainTimer);
    drainTimer = setTimeout(
      () =>
        fail(
          "The last words could not be confirmed. You can keep the text received so far or try again.",
        ),
      15000,
    );
  }
  function stop() {
    if (cancelled || ended || phase === "finishing" || phase === "idle") return;
    if (phase === "connecting") {
      cancel();
      return;
    }
    clearTimeout(timer);
    setPhase("finishing");
    // Stop physical capture immediately; drain samples already posted by worklet.
    stream?.getTracks().forEach((t) => t.stop());
    capture?.port.postMessage("stop");
    drainTimer = setTimeout(
      () =>
        fail(
          "The microphone could not finish its recording. Try again or type your idea.",
        ),
      2000,
    );
  }
  function cancel() {
    if (cancelled || ended) return;
    cancelled = true;
    clean();
  }
  async function start() {
    if (phase !== "idle" || cancelled || ended) return;
    setPhase("connecting");
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Microphone access needs a secure page. You can still type your idea.",
        );
      context = new AudioContext();
      await context.resume();
      if (cancelled) {
        releaseAudio();
        return;
      }
      const incoming = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (cancelled) {
        incoming.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = incoming;
      const credential = await options.token();
      if (cancelled) return;
      if (
        credential.model !== "ink-2" ||
        typeof credential.token !== "string" ||
        !credential.token
      )
        throw new Error("Voice setup returned an unexpected response.");
      const url = new URL("wss://api.cartesia.ai/stt/websocket");
      url.searchParams.set("access_token", credential.token);
      url.searchParams.set("cartesia_version", credential.version);
      url.searchParams.set("model", "ink-2");
      url.searchParams.set("encoding", "pcm_f32le");
      url.searchParams.set("sample_rate", String(context!.sampleRate));
      socket = new WebSocket(url);
      const connected = socket;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () =>
            reject(
              new Error(
                "The voice connection took too long. Try again when connected.",
              ),
            ),
          10000,
        );
        connected.onopen = () => {
          clearTimeout(timeout);
          resolve();
        };
        connected.onerror = () => {
          clearTimeout(timeout);
          reject(
            new Error("Voice could not connect. Your draft is still here."),
          );
        };
        connected.onclose = () => {
          clearTimeout(timeout);
          reject(new Error("Voice closed before recording started."));
        };
      });
      if (cancelled) return;
      socket.onerror = () =>
        fail("Voice was interrupted. Your existing draft is safe.");
      socket.onclose = () => {
        if (!ended && !cancelled)
          fail("Voice disconnected before all words were confirmed.");
      };
      socket.onmessage = ({ data }) => {
        if (cancelled || ended) return;
        try {
          const event = JSON.parse(data);
          if (event.type === "error") {
            fail(
              "Cartesia could not transcribe this thought. Try again or type it.",
            );
            return;
          }
          if (event.type === "transcript") {
            transcript = inkTranscript(transcript, event);
            options.partial(transcript.final + transcript.interim);
          } else if (event.type === "flush_done" && finishSent) {
            socket?.send("close");
          } else if (event.type === "done" && finishSent) complete();
        } catch {
          fail("Voice returned an unreadable reply. Your draft is safe.");
        }
      };
      const moduleUrl = URL.createObjectURL(
        new Blob([workletSource], { type: "application/javascript" }),
      );
      try {
        await context!.audioWorklet.addModule(moduleUrl);
      } finally {
        URL.revokeObjectURL(moduleUrl);
      }
      if (cancelled) return;
      source = context!.createMediaStreamSource(stream!);
      capture = new AudioWorkletNode(context!, "fork-night-capture");
      capture.port.onmessage = ({ data }) => {
        if (cancelled || ended) return;
        if (data.flushed) {
          finalize();
          return;
        }
        if (
          !(data.samples instanceof Float32Array) ||
          socket?.readyState !== WebSocket.OPEN ||
          finishSent
        )
          return;
        if (socket.bufferedAmount > context!.sampleRate * 4) {
          fail(
            "The connection is too slow for live voice. Try again or type your thought.",
          );
          return;
        }
        const buffer = new ArrayBuffer(data.samples.length * 4),
          view = new DataView(buffer);
        let power = 0;
        data.samples.forEach((sample: number, i: number) => {
          view.setFloat32(i * 4, sample, true);
          power += sample * sample;
        });
        socket.send(buffer);
        options.level(Math.min(1, Math.sqrt(power / data.samples.length) * 6));
      };
      source.connect(capture);
      // A silent output keeps the worklet scheduled, including Safari.
      capture.connect(context!.destination);
      setPhase("recording");
      timer = setTimeout(stop, VOICE_SECONDS * 1000);
    } catch (error) {
      if (cancelled) {
        releaseAudio();
        return;
      }
      fail(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Microphone permission was declined. You can type your thought, or enable the mic and try again."
          : error instanceof Error
            ? error.message
            : "The microphone could not start. You can type your idea.",
      );
    }
  }
  return { start, stop, cancel };
}
