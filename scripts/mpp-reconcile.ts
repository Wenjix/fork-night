import { pathToFileURL } from "node:url";
import { pilotAdmin } from "../src/generation/client.ts";
import { loadMppAdapter } from "../src/mpp/adapter.ts";
import { moderatoReader } from "../src/mpp/chain.ts";
import { MPP_COMMANDS } from "../src/mpp/ids.ts";
import { reconcileMppIntents } from "../src/mpp/reconcile.ts";
import { supabaseFundingLedger } from "../src/x402/ledger.ts";
import { supabaseReceiptStore } from "../src/x402/store.ts";

// Operator-only, testnet-only. Checks every MPP intent without a receipt or expiry against Tempo Moderato.
// node --env-file-if-exists=.env.local scripts/mpp-reconcile.ts [--apply] [--recheck-expired]
// --recheck-expired also re-reads intents already marked expired and reports (never writes) any the chain now shows paid.
// (The root package.json has no mpp:* scripts; the memo check's keccak256 comes from the isolated adapter.)
async function main(argv: string[]) {
  const args = argv[0] === "--" ? argv.slice(1) : argv; // pnpm run forwards the separator
  const apply = args.includes("--apply");
  const recheckExpired = args.includes("--recheck-expired");
  if (args.some((arg) => arg !== "--apply" && arg !== "--recheck-expired")) {
    console.error(`Usage: ${MPP_COMMANDS.reconcile} [--apply] [--recheck-expired]`);
    process.exitCode = 1;
    return;
  }
  try {
    const admin = pilotAdmin();
    const adapter = await loadMppAdapter();
    const report = await reconcileMppIntents({
      store: supabaseReceiptStore(admin),
      ledger: supabaseFundingLedger(admin),
      chain: moderatoReader({ keccak: adapter.keccakUtf8 }),
      now: () => new Date(),
      apply,
      recheckExpired,
    });
    console.log(JSON.stringify(report, null, 2));
    if (!apply)
      console.error("Dry run: nothing was written. Re-run with --apply to credit paid intents and mark provably expired ones.");
    if (report.errors) process.exitCode = 1;
  } catch (error) {
    console.error(`mpp reconcile failed: ${(error as Error).message}`);
    console.error(apply ? "Intents processed before the failure keep their records; re-running is safe." : "Nothing was written.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
