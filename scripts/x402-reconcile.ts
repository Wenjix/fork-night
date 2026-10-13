import { pilotAdmin } from "../src/generation/client.ts";
import { BASE_SEPOLIA, SOLANA_DEVNET } from "../src/x402/ids.ts";
import { supabaseFundingLedger } from "../src/x402/ledger.ts";
import { baseSepoliaReader, reconcileIntents, solanaDevnetReader } from "../src/x402/reconcile.ts";
import { supabaseReceiptStore } from "../src/x402/store.ts";

// Operator-only, testnet-only. Checks every x402 intent without a receipt or expiry against the chain.
// node --env-file-if-exists=.env.local scripts/x402-reconcile.ts [--apply]
const args = process.argv.slice(2);
if (args[0] === "--") args.shift(); // pnpm run forwards the separator
const apply = args.includes("--apply");
if (args.some((arg) => arg !== "--apply")) {
  console.error("Usage: npm run x402:reconcile [-- --apply]");
  process.exitCode = 1;
} else {
  try {
    const admin = pilotAdmin();
    const report = await reconcileIntents({
      store: supabaseReceiptStore(admin),
      ledger: supabaseFundingLedger(admin),
      chains: { [BASE_SEPOLIA]: baseSepoliaReader(), [SOLANA_DEVNET]: solanaDevnetReader() },
      now: () => new Date(),
      apply,
    });
    console.log(JSON.stringify(report, null, 2));
    if (!apply)
      console.error("Dry run: nothing was written. Re-run with --apply to credit paid intents and mark provably expired ones.");
    if (report.errors) process.exitCode = 1;
  } catch (error) {
    console.error(`x402 reconcile failed: ${(error as Error).message}`);
    console.error(apply
      ? "Intents processed before the failure keep their records; re-running is safe."
      : "Nothing was written.");
    process.exitCode = 1;
  }
}
