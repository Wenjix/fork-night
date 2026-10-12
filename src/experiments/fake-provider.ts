import { join } from "node:path";
import { digest, readJson, writeJson } from "./storage.ts";
import { formatUsd } from "./money.ts";
import type {
  ExperimentFixture,
  FakeResponse,
  InheritedPackage,
} from "./types.ts";

export class UncertainProviderOutcome extends Error {}

export interface FakeProviderRequest {
  attemptId: string;
  inputDigest: string;
  fixture: ExperimentFixture;
  inherited: InheritedPackage;
}

interface SavedProviderResult {
  requestKey: string;
  inputDigest: string;
  acceptedCount: 1;
  response: FakeResponse;
}

const escapeXml = (value: string) =>
  value.replace(
    /[<>&"']/g,
    (character) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[character]!,
  );

function panelSvg(request: FakeProviderRequest, panel: number): string {
  const continuation = request.inherited.moments.length > 0;
  const lanternX = panel === 0 ? 504 : 632;
  const caption = escapeXml(request.fixture.captions[panel]);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768" viewBox="0 0 1024 768" role="img" aria-labelledby="title desc">
  <title id="title">The Lantern Archive — panel ${panel + 1}</title>
  <desc id="desc">Original deterministic SVG fixture. Mara, in a coral jacket, holds a lantern beside an indigo archive${continuation ? " and a moonlit canal" : " containing a glowing map"}. No AI image generation has occurred.</desc>
  <rect width="1024" height="768" fill="#141d34"/>
  <circle cx="838" cy="100" r="44" fill="#efdfac"/>
  <path d="M0 460 L90 425 L90 285 L180 285 L180 190 L402 190 L402 444 L584 444 L584 330 L766 330 L766 462 L1024 462 L1024 768 L0 768Z" fill="#293857"/>
  <path d="M135 295 L135 242 L345 242 L345 295Z" fill="#1c2844"/>
  <g fill="#e4ad6a"><rect x="220" y="254" width="38" height="68"/><rect x="285" y="254" width="38" height="68"/><rect x="220" y="353" width="38" height="66"/><rect x="650" y="370" width="44" height="58"/></g>
  <path d="M0 539 Q240 492 470 565 Q700 639 1024 514 L1024 670 L0 670Z" fill="#397683"/>
  <g fill="none" stroke="#87b2a6" stroke-width="5" opacity="0.7"><path d="M86 592 Q258 543 444 600"/><path d="M558 615 Q743 661 925 580"/></g>
  ${panel === 1 ? '<path d="M774 559 L774 441 Q821 400 868 441 L868 559Z" fill="#efbf71"/><path d="M789 555 L789 451 Q821 425 853 451 L853 555Z" fill="#31414a"/>' : '<path d="M452 380 L563 353 L578 440 L468 458Z" fill="#dbcaa0"/><path d="M477 410 L501 390 L538 404 L557 377" fill="none" stroke="#769782" stroke-width="4"/>'}
  <circle cx="428" cy="382" r="30" fill="#eac1a2"/>
  <path d="M398 379 Q390 329 432 338 Q463 340 457 373 L441 355Z" fill="#202333"/>
  <path d="M405 412 L448 412 L470 495 L390 495Z" fill="#d87567"/>
  <path d="M407 495 L400 552 M449 495 L459 550" stroke="#24293a" stroke-width="18"/>
  <path d="M447 423 L${lanternX - 15} 405" stroke="#d87567" stroke-width="15"/>
  <circle cx="${lanternX}" cy="428" r="53" fill="#efd390" opacity="0.12"/>
  <path d="M${lanternX - 10} 399 Q${lanternX} 377 ${lanternX + 10} 399" fill="none" stroke="#d4a655" stroke-width="5"/>
  <rect x="${lanternX - 17}" y="400" width="34" height="52" rx="5" fill="#d4a655"/><rect x="${lanternX - 10}" y="409" width="20" height="33" fill="#ffe5a1"/>
  <rect y="670" width="1024" height="98" fill="#f5eedb"/>
  <text x="40" y="711" font-family="Georgia,serif" font-size="23" fill="#263346">${caption}</text>
  <text x="40" y="742" font-family="Arial,sans-serif" font-size="13" fill="#52616e">DETERMINISTIC FIXTURE · NO MODEL CALL · PANEL ${panel + 1}</text>
</svg>\n`;
}

export function fakeQuote(request: FakeProviderRequest): {
  usage: FakeResponse["usage"];
  simulatedExpenseUsd: string;
} {
  // These are synthetic usage counts and rates, not measurements of a model.
  const inputTokens = Math.ceil(
    Buffer.byteLength(
      JSON.stringify({
        prompt: request.fixture.prompt,
        inherited: request.inherited,
      }),
    ) / 4,
  );
  const usage = { inputTokens, outputTokens: 120, images: 2 };
  const microUsd =
    BigInt(usage.inputTokens) * 2n +
    BigInt(usage.outputTokens) * 8n +
    BigInt(usage.images) * 12_000n;
  return { usage, simulatedExpenseUsd: formatUsd(microUsd) };
}

/** Saves a remote-like result separately from the client receipt for recovery tests. */
export class DeterministicFakeProvider {
  private readonly directory: string;
  constructor(rootDirectory: string) {
    this.directory = join(rootDirectory, "_fake-provider");
  }

  async submit(request: FakeProviderRequest): Promise<FakeResponse> {
    const path = join(this.directory, `${request.attemptId}.json`);
    const existing = await readJson<SavedProviderResult>(path);
    if (existing) {
      if (existing.inputDigest !== request.inputDigest)
        throw new Error("Provider request key was reused for different inputs");
      return existing.response;
    }
    const quote = fakeQuote(request);
    const response: FakeResponse = {
      requestId: `fake_${digest(request.attemptId + request.inputDigest).slice(0, 24)}`,
      model: "fork-night-svg-fixture-v1",
      panels: [0, 1].map((panel) => ({
        svg: panelSvg(request, panel),
        width: 1024,
        height: 768,
      })),
      captions: request.fixture.captions,
      ...quote,
    };
    if (request.fixture.scenario === "invalid-output") response.panels.pop();
    await writeJson(path, {
      requestKey: request.attemptId,
      inputDigest: request.inputDigest,
      acceptedCount: 1,
      response,
    } satisfies SavedProviderResult);
    if (request.fixture.scenario.startsWith("lost-reply")) {
      throw new UncertainProviderOutcome(
        "The provider accepted the request, but its reply was lost. No new generation is authorized.",
      );
    }
    return response;
  }

  async recover(request: FakeProviderRequest): Promise<FakeResponse | null> {
    if (request.fixture.scenario === "lost-reply-uncertain") return null;
    const stored = await readJson<SavedProviderResult>(
      join(this.directory, `${request.attemptId}.json`),
    );
    if (stored && stored.inputDigest !== request.inputDigest)
      throw new Error(
        "Stored provider input digest does not match the attempt",
      );
    return stored?.response ?? null;
  }
}
