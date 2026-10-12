// This deployment only consumes string bindings. Full Worker types can be generated
// separately with `wrangler types` when additional Cloudflare APIs are introduced.
declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}
