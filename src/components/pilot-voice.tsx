"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square, X } from "lucide-react";
import { createInkRecorder, type VoiceState } from "@/lib/ink-recorder";

export function PilotVoice({
  enabled,
  disabled,
  token,
  onText,
  onRecovered,
  onBusy,
}: {
  enabled: boolean;
  disabled: boolean;
  token: Parameters<typeof createInkRecorder>[0]["token"];
  onText: (text: string) => void;
  onRecovered: (text: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [phase, setPhase] = useState<VoiceState>("idle");
  const [partial, setPartial] = useState("");
  const [error, setError] = useState("");
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<ReturnType<typeof createInkRecorder> | null>(null);
  const callbacks = useRef({ token, onText, onRecovered, onBusy });
  callbacks.current = { token, onText, onRecovered, onBusy };
  const mounted = useRef(false);
  const holding = useRef(false);
  useEffect(() => {
    mounted.current = true;
    function interrupt() {
      if (document.visibilityState === "hidden" && recorder.current) {
        recorder.current.cancel();
        recorder.current = null;
        setPartial("");
        setError(
          "Recording stopped when you left the page. Your draft is still here.",
        );
      }
    }
    document.addEventListener("visibilitychange", interrupt);
    window.addEventListener("pagehide", interrupt);
    return () => {
      mounted.current = false;
      recorder.current?.cancel();
      callbacks.current.onBusy(false);
      document.removeEventListener("visibilitychange", interrupt);
      window.removeEventListener("pagehide", interrupt);
    };
  }, []);
  useEffect(() => {
    if (phase !== "recording") return;
    const started = performance.now();
    setElapsed(0);
    const timer = setInterval(
      () =>
        setElapsed(
          Math.min(30, Math.floor((performance.now() - started) / 1000)),
        ),
      250,
    );
    return () => clearInterval(timer);
  }, [phase]);
  function start() {
    if (!enabled || disabled || recorder.current) return;
    setPartial("");
    setError("");
    const session = createInkRecorder({
      token: () => callbacks.current.token(),
      state: (next) => {
        if (!mounted.current) return;
        setPhase(next);
        callbacks.current.onBusy(next !== "idle");
        if (next === "idle") recorder.current = null;
      },
      partial: (text) => {
        if (mounted.current) setPartial(text);
      },
      complete: (text) => {
        if (mounted.current) {
          setPartial("");
          callbacks.current.onText(text);
        }
      },
      error: (message, text) => {
        if (mounted.current) {
          setError(message);
          if (text) callbacks.current.onRecovered(text);
          setPartial("");
        }
      },
      level: (value) => {
        if (mounted.current) setLevel(value);
      },
    });
    recorder.current = session;
    void session.start();
  }
  function release() {
    if (!holding.current) return;
    holding.current = false;
    recorder.current?.stop();
  }
  const active = phase !== "idle";
  return (
    <div className={`pilot-voice ${active ? "is-active" : ""}`}>
      <div className="pilot-voice-controls">
        <button
          type="button"
          className="pilot-mic"
          disabled={!enabled || disabled || phase === "finishing"}
          aria-label={
            phase === "recording"
              ? "Release to finish recording"
              : "Hold to talk"
          }
          aria-describedby="pilot-voice-help"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            holding.current = true;
            start();
          }}
          onPointerUp={release}
          onPointerCancel={() => {
            holding.current = false;
            recorder.current?.cancel();
          }}
          onLostPointerCapture={release}
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if ((event.key === " " || event.key === "Enter") && !event.repeat) {
              event.preventDefault();
              holding.current = true;
              start();
            }
          }}
          onKeyUp={(event) => {
            if (event.key === " " || event.key === "Enter") {
              event.preventDefault();
              release();
            }
          }}
          onBlur={release}
        >
          <Mic size={23} />
          <span>
            {phase === "connecting"
              ? "Opening mic…"
              : phase === "recording"
                ? "Listening… release to finish"
                : phase === "finishing"
                  ? "Finishing your words…"
                  : "Hold to talk"}
          </span>
          <span className="pilot-voice-level" aria-hidden="true">
            <i style={{ transform: `scaleY(${0.15 + level * 0.85})` }} />
          </span>
        </button>
        {phase === "recording" ? (
          <button
            type="button"
            className="text-button"
            onClick={() => recorder.current?.stop()}
          >
            <Square size={14} /> Finish recording
          </button>
        ) : !active ? (
          <button
            type="button"
            className="text-button"
            disabled={!enabled || disabled}
            onClick={start}
          >
            Tap to record instead
          </button>
        ) : null}
        {active && (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              recorder.current?.cancel();
              setPartial("");
            }}
          >
            <X size={15} /> Cancel recording
          </button>
        )}
      </div>
      {phase === "recording" && (
        <p
          className="pilot-voice-time"
          aria-label={`${elapsed} seconds recorded, 30 seconds maximum`}
        >
          {elapsed}s / 30s
        </p>
      )}
      <p id="pilot-voice-help" className="pilot-helper-copy">
        {enabled
          ? "Up to 30 seconds. Audio goes to Cartesia; your words return here to edit."
          : "Voice is paused. You can still type your thought or write the two beats."}
      </p>
      <span className="sr-only" role="status">
        {phase === "recording"
          ? "Microphone is recording."
          : phase === "finishing"
            ? "Microphone off. Finishing transcription."
            : ""}
      </span>
      {partial && <p className="pilot-live-words">{partial}</p>}
      {error && (
        <p className="pilot-inline-notice" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
