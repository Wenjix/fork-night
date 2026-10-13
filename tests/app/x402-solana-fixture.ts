// Real answers from https://api.devnet.solana.com to the two read-only lookups the @x402/svm exact
// client makes while signing (request shapes from @solana/kit 5.5.1), captured once on 2026-10-12.
// Results stay raw JSON so the u64 rentEpoch reaches kit's bigint parser unchanged.
export const DEVNET_RPC_URL = "https://api.devnet.solana.com";

const RESPONSES: Record<string, { params: string; result: string }> = {
  getAccountInfo: {
    params: '["4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",{"encoding":"base64","commitment":"confirmed"}]',
    result: '{"context":{"apiVersion":"4.4.0-beta.0","slot":510254087},"value":{"data":["AQAAAOuFRM+RGCd6ljLpmVBmZRu/sUCLhXPrwC5T76tavw4LYLw+urU4BuIGAQEAAACoBjP/Bn2I36XUNXv0TibOzM8IZmiBA8a6YJ+kTBjSCA==","base64"],"executable":false,"lamports":449425905289,"owner":"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA","rentEpoch":18446744073709551615,"space":82}}',
  },
  getLatestBlockhash: {
    params: '[{"commitment":"confirmed"}]',
    result: '{"context":{"apiVersion":"4.4.0-beta.0","slot":510254088},"value":{"blockhash":"Eyq5TJw1sWfJCN3L3cNcudnaHLQdF8Rqw6ZHsbzEMnkC","lastValidBlockHeight":497480704}}',
  },
};

/** The captured blockhash, for transactions a test builds by hand. */
export const DEVNET_BLOCKHASH: { blockhash: string; lastValidBlockHeight: number } =
  JSON.parse(RESPONSES.getLatestBlockhash.result).value;

/** A fetch that answers exactly those two calls, recording each method, and throws on any other request. */
export function devnetFetch(methods: string[] = []) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const body = typeof init?.body === "string" ? init.body : "";
    let call: { id?: unknown; method?: unknown; params?: unknown } = {};
    try { call = JSON.parse(body) ?? {}; } catch { call = {}; }
    const method = typeof call.method === "string" && Object.hasOwn(RESPONSES, call.method) ? call.method : undefined;
    if (url !== DEVNET_RPC_URL || !method || JSON.stringify(call.params) !== RESPONSES[method].params)
      throw new Error(`An offline x402 test tried to reach the network: ${url} ${body.slice(0, 160)}`);
    methods.push(method);
    return new Response(`{"jsonrpc":"2.0","result":${RESPONSES[method].result},"id":${JSON.stringify(call.id ?? null)}}`, {
      headers: { "content-type": "application/json" },
    });
  };
}
