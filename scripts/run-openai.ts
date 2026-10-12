import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import sharp from "sharp";
import { runOpenAiContinuation } from "../src/experiments/openai-live.ts";

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("--help")) {
    console.log("Usage: npm run experiment:openai -- <attempt-id> <fixture-json>\nPaid, sequential two-panel experiment. Shared $10 ledger in .local/experiments/openai-live. No automatic retries. Reads OPENAI_API_KEY from the environment or .env.local.");
    return;
  }
  if (args.length !== 2) throw new Error("Expected an attempt ID and fixture JSON path.");
  let apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    try { apiKey = parseEnv(await readFile(".env.local", "utf8")).OPENAI_API_KEY; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  if (!apiKey) throw new Error("Add OPENAI_API_KEY to the ignored .env.local file.");
  const fixture = JSON.parse(await readFile(resolve(args[1]!), "utf8")) as {
    referencePath: string; sheetFrame?: number; context: string; prompt: string; captions: [string, string];
  };
  let original = await readFile(resolve(fixture.referencePath));
  if (fixture.sheetFrame !== undefined) {
    if (!Number.isInteger(fixture.sheetFrame) || fixture.sheetFrame < 0 || fixture.sheetFrame > 5) throw new Error("Invalid sprite frame.");
    const metadata = await sharp(original).metadata();
    const width = Math.floor(metadata.width! / 3), height = Math.floor(metadata.height! / 2);
    original = await sharp(original).extract({ left: (fixture.sheetFrame % 3) * width, top: Math.floor(fixture.sheetFrame / 3) * height, width, height }).png().toBuffer();
  }
  const directory = resolve(".local/experiments/openai-live");
  const result = await runOpenAiContinuation({ attemptId: args[0]!, original, context: fixture.context, prompt: fixture.prompt, captions: fixture.captions }, {
    directory, apiKey, onProgress: (message) => console.log(message),
  });
  console.log(JSON.stringify({ ...result, directory: resolve(directory, args[0]!) }, null, 2));
  if (result.status !== "complete") process.exitCode = 1;
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Experiment failed."); process.exitCode = 1; });
