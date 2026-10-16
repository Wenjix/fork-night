import type { BuildExtension } from "@trigger.dev/build";

/** Dependencies install in the remote image from the adapter's own frozen lock. */
export function wrenAdapterBuild(): BuildExtension {
  return {
    name: "wren-isolated-payment-adapter",
    onBuildComplete(context) {
      if (context.target !== "deploy") return;
      context.addLayer({
        id: "wren-isolated-payment-adapter",
        dependencies: { pnpm: "10.18.3" },
        commands: ["node scripts/package-wren-adapter.mjs"],
      });
    },
  };
}
