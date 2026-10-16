import { defineConfig } from "@trigger.dev/sdk";
import { additionalFiles } from "@trigger.dev/build/extensions/core";
import { wrenAdapterBuild } from "./scripts/wren-adapter-build.ts";

export default defineConfig({
  project: "proj_mgjcdpmejdtuazlikyzo",
  dirs: ["./src/trigger"],
  maxDuration: 600,
  retries: { enabledInDev: false, default: { maxAttempts: 1 } },
  // Keep request bodies, images and authorization headers out of task logs.
  build: {
    external: ["sharp"],
    extensions: [
      additionalFiles({ files: ["./public/art/*.webp", "./vendor/mpp-adapter/index.mjs", "./vendor/mpp-adapter/wren.mjs",
        "./vendor/mpp-adapter/package.json", "./vendor/mpp-adapter/pnpm-lock.yaml", "./scripts/package-wren-adapter.mjs"] }),
      wrenAdapterBuild(),
    ],
  },
});
