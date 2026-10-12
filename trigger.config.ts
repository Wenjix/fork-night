import { defineConfig } from "@trigger.dev/sdk";
import { additionalFiles } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  project: "proj_mgjcdpmejdtuazlikyzo",
  dirs: ["./src/trigger"],
  maxDuration: 600,
  retries: { enabledInDev: false, default: { maxAttempts: 1 } },
  // Keep request bodies, images and authorization headers out of task logs.
  build: {
    external: ["sharp"],
    extensions: [additionalFiles({ files: ["./public/art/*.webp"] })],
  },
});
