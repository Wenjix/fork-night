# MPP adapter (isolated)

The only place the MPP door loads `mppx` 0.13.4 and `viem` 2.57.3. Fork Night's root dependencies (viem 2.56.5 for `@x402/evm` and Privy, no mppx) never change because of the MPP door.

- **Install** once, on its own: `cd vendor/mpp-adapter && pnpm install --frozen-lockfile --ignore-scripts` (pnpm 10.18.3). It has its own `package.json` and `pnpm-lock.yaml`, with 19 packages, no install scripts and no native code. Never resolve it again without `--frozen-lockfile`. The root has no `pnpm-workspace.yaml`, so the root install never sees this folder. Its `node_modules/` is Git-ignored by the root `.gitignore`.
- **Loading.** `src/mpp/adapter.ts` loads `index.mjs` at run time, after the route's gate, through `import(/* turbopackIgnore: true */ fileUrl)`. Before the import it checks the SHA-256 of `index.mjs` and `pnpm-lock.yaml` against `ADAPTER_PINS`, and after it the adapter, mppx and viem versions; any other file or version is refused. **Any edit to `index.mjs` or the lockfile must update those pins** (a test compares them). `MPP_ADAPTER` can point elsewhere only under `NODE_ENV=test`. `src/mpp` never imports mppx, viem or ox itself.
- **Network.** The adapter's own HTTP transport calls only `https://rpc.moderato.tempo.xyz` and never follows a redirect.
- **Boundary.** Only plain data and adapter-made accounts cross it. The API covers:
  - creating challenges;
  - reading credentials;
  - validating and broadcasting (with whether the transaction left the process);
  - decoding transactions and computing the hash before broadcast;
  - the patron agent's signature;
  - keys, addresses and keccak256.
- **Scope:** Tempo Moderato testnet (chain 42431), pull mode, no fee sponsor. See [`docs/submission/MPP.md`](../../docs/submission/MPP.md) for the door's design and testnet evidence.
