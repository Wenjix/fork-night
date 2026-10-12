import { test } from "node:test";
import assert from "node:assert/strict";
import { createInkRecorder } from "../../src/lib/ink-recorder.ts";

test("voice capture stops at 30 seconds and cancels safely during permission setup", async (t) => {
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  function install(name: string, value: unknown) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true });
  }
  t.after(() => {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  let stopped = 0,
    closed = 0,
    issued = 0;
  let permission: () => Promise<unknown> = async () => ({
    getTracks: () => [{ stop: () => stopped++ }],
  });
  const commands: string[] = [];
  install("window", { isSecureContext: true });
  install("navigator", { mediaDevices: { getUserMedia: () => permission() } });
  install(
    "AudioContext",
    class {
      state = "running";
      sampleRate = 48000;
      destination = {};
      audioWorklet = { addModule: async () => {} };
      resume() {
        return Promise.resolve();
      }
      close() {
        this.state = "closed";
        closed++;
        return Promise.resolve();
      }
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }
    },
  );
  install(
    "AudioWorkletNode",
    class {
      port = {
        onmessage: (_: unknown) => {},
        postMessage: (command: string) => {
          if (command === "stop")
            this.port.onmessage({ data: { flushed: true } });
        },
      };
      connect() {}
      disconnect() {}
    },
  );
  install(
    "WebSocket",
    class {
      static OPEN = 1;
      static CONNECTING = 0;
      readyState = 1;
      bufferedAmount = 0;
      onopen?: () => void;
      onmessage?: (event: { data: string }) => void;
      onclose?: () => void;
      onerror?: () => void;
      constructor() {
        queueMicrotask(() => this.onopen?.());
      }
      send(value: string) {
        commands.push(value);
        if (value === "close")
          queueMicrotask(() =>
            this.onmessage?.({ data: JSON.stringify({ type: "done" }) }),
          );
      }
      close() {
        this.readyState = 3;
      }
    },
  );
  let phase = "idle";
  const options = () => ({
    token: async () => {
      issued++;
      return {
        token: "test",
        version: "2026-08-14",
        model: "ink-2",
        maxSeconds: 30,
      };
    },
    state: (next: string) => {
      phase = next;
    },
    partial() {},
    complete() {},
    error() {},
    level() {},
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const recorder = createInkRecorder(options());
  await recorder.start();
  assert.equal(phase, "recording");
  t.mock.timers.tick(30000);
  assert.equal(phase, "finishing");
  assert(stopped > 0);
  assert(closed > 0);
  assert.deepEqual(commands, ["finalize"]);
  recorder.cancel();
  assert.equal(phase, "idle");

  let grant: ((stream: unknown) => void) | undefined;
  permission = () =>
    new Promise((resolve) => {
      grant = resolve;
    });
  const late = createInkRecorder(options());
  const starting = late.start();
  await Promise.resolve();
  late.stop();
  const before = stopped;
  grant!({ getTracks: () => [{ stop: () => stopped++ }] });
  await starting;
  assert.equal(stopped, before + 1);
  assert.equal(issued, 1);
  assert.equal(phase, "idle");
});
