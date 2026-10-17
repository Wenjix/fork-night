import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The theme contract (globals.css) is resolved per room. This reads the light root and the neon block as text, resolves the
// var() aliases the way the cascade would, and holds each theme to the same pair rules.
const root = fileURLToPath(new URL("../../", import.meta.url));
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@import[^;]*;/g, "");
const read = (path: string) => strip(readFileSync(join(root, path), "utf8"));
const NEON = "src/app/room-theme-neon.css";
const NEON_FILES = [NEON, "src/app/pilot/kessler.css", "src/app/room-themes.css"];

type Rule = { selector: string; body: string };

/** Every rule in a stylesheet, including the ones inside @media and @supports. */
function rules(css: string): Rule[] {
  const found: Rule[] = [];
  let at = 0;
  while (at < css.length) {
    const open = css.indexOf("{", at);
    if (open < 0) break;
    let depth = 1;
    let close = open + 1;
    for (; close < css.length && depth; close++) depth += css[close] === "{" ? 1 : css[close] === "}" ? -1 : 0;
    const selector = css.slice(at, open).trim();
    const body = css.slice(open + 1, close - 1);
    if (/^@(media|supports|layer)\b/.test(selector)) found.push(...rules(body));
    else found.push({ selector, body });
    at = close;
  }
  return found;
}

/** Declarations of one rule body, splitting on the semicolons that sit outside parentheses. */
function declarations(body: string): Map<string, string> {
  const map = new Map<string, string>();
  let depth = 0;
  let start = 0;
  const take = (end: number) => {
    const part = body.slice(start, end);
    const colon = part.indexOf(":");
    if (colon > 0) map.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
  };
  for (let index = 0; index < body.length; index++) {
    if (body[index] === "(") depth++;
    else if (body[index] === ")") depth--;
    else if (body[index] === ";" && !depth) {
      take(index);
      start = index + 1;
    }
  }
  take(body.length);
  return map;
}

// A selector list splits at the commas outside parentheses, so :is(a, b) stays whole.
const splitList = (list: string) => list.split(/,(?![^(]*\))/).map((part) => part.trim());
const selectors = (rule: Rule) => splitList(rule.selector);

/** The tokens a theme block declares, merged in source order. */
function scope(path: string, pick: (rule: Rule) => boolean): Map<string, string> {
  const merged = new Map<string, string>();
  for (const rule of rules(read(path))) if (pick(rule)) for (const [name, value] of declarations(rule.body)) merged.set(name, value);
  return merged;
}

// The light world is the two :root blocks and the contract block that is declared on :root and on [data-room-theme].
const light = scope("src/app/globals.css", (rule) => selectors(rule).every((part) => part === ":root" || part === "[data-room-theme]"));
// The neon world is the one rule that sets the room's tokens on its container, on main, on the wrapper, or on all three.
const isNeonContainer = (part: string) => /\[data-room-theme="neon"\]$/.test(part) && !/\s/.test(part.replace(/^:root\s+/, ""));
const neonBlock = (rule: Rule) => selectors(rule).some(isNeonContainer) && declarations(rule.body).has("--surface");
const neon = scope(NEON, neonBlock);

/** A token's value with its var() aliases followed: the theme's own scope first, then what the root hands down. */
function resolve(name: string, ...scopes: Map<string, string>[]): string {
  const seen = new Set<string>();
  const walk = (token: string): string => {
    assert(!seen.has(token), `${token} refers to itself`);
    seen.add(token);
    const raw = scopes.map((one) => one.get(token)).find((value) => value !== undefined);
    assert(raw !== undefined, `${token} is not defined`);
    const alias = raw.match(/^var\((--[\w-]+)\)$/);
    return alias ? walk(alias[1]) : raw;
  };
  return walk(name);
}

function luminance(hex: string): number {
  let digits = hex.replace("#", "");
  if (digits.length === 3) digits = [...digits].map((digit) => digit + digit).join("");
  assert.match(digits, /^[0-9a-f]{6}$/i, `${hex} is a hex colour`);
  const [red, green, blue] = [0, 2, 4].map((offset) => {
    const channel = parseInt(digits.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

// Foreground, background, the least contrast it may have. 4.5 is body text; 3 is a control border or a non-text mark.
const PAIRS: [string, string, number][] = [
  ["--ink", "--surface", 4.5],
  ["--ink", "--paper", 4.5],
  ["--muted", "--surface", 4.5],
  ["--muted", "--paper", 4.5],
  ["--accent", "--surface", 4.5],
  ["--accent", "--paper", 4.5],
  ["--accent", "--accent-soft", 4.5],
  ["--accent-strong", "--surface", 4.5],
  ["--danger", "--surface", 4.5],
  ["--danger", "--danger-soft", 4.5],
  ["--success", "--surface", 4.5],
  ["--success", "--success-soft", 4.5],
  ["--on-accent", "--accent-fill", 4.5],
  ["--on-accent", "--danger-fill", 4.5],
  ["--on-signal", "--signal", 4.5],
  ["--agent-ink", "--agent", 4.5],
  ["--ink", "--selection", 4.5],
  ["--edge", "--surface", 3],
  ["--edge", "--paper", 3],
  ["--accent-fill", "--surface", 3],
  ["--focus-ring", "--surface", 3],
  ["--focus-ring", "--paper", 3],
];

// Pairs only the neon room puts together: the hover fill under --on-accent, cyan text on the dark surfaces and washes, and the
// status colours on the accent wash that the generation chip uses.
const NEON_PAIRS: [string, string, number][] = [
  ["--on-accent", "--accent-fill-hover", 4.5],
  ["--signal", "--surface", 4.5],
  ["--signal", "--paper", 4.5],
  ["--signal", "--accent-soft", 4.5],
  ["--signal", "--signal-soft", 4.5],
  ["--ink", "--signal-soft", 4.5],
  ["--ink", "--accent-soft", 4.5],
  ["--muted", "--accent-soft", 4.5],
  ["--danger", "--accent-soft", 4.5],
  ["--success", "--accent-soft", 4.5],
];

for (const [theme, scopes] of [["light root", [light]], ["neon", [neon, light]]] as const) {
  test(`${theme}: every contract pair meets its contrast`, () => {
    const failures: string[] = [];
    for (const [foreground, background, least] of theme === "neon" ? [...PAIRS, ...NEON_PAIRS] : PAIRS) {
      const ratio = contrast(resolve(foreground, ...scopes), resolve(background, ...scopes));
      if (ratio < least) failures.push(`${foreground} on ${background} is ${ratio.toFixed(2)}:1, needs ${least}:1`);
    }
    assert.deepEqual(failures, []);
  });
}

test("neon: the one block defines every contract token and keeps the base names as aliases", () => {
  for (const token of ["--paper", "--surface", "--ink", "--muted", "--line", "--edge", "--accent", "--accent-strong", "--accent-soft", "--accent-fill", "--accent-fill-hover", "--on-accent",
    "--signal", "--on-signal", "--signal-soft", "--success", "--danger", "--danger-fill", "--selection", "--focus-ring", "--backdrop", "--glow"]) {
    assert(neon.has(token), `${token} is missing from the neon block`);
  }
  // Older rules read these names; each one points at the contract, so the room's colours are written once.
  for (const [name, target] of [["--line-strong", "--edge"], ["--violet", "--accent"], ["--violet-dark", "--accent-strong"], ["--violet-soft", "--accent-soft"], ["--yellow", "--signal"]]) {
    assert.equal(neon.get(name), `var(${target})`, `${name} is an alias of ${target}`);
  }
  assert.equal(neon.get("color-scheme"), "dark");
  // The block reaches the shared room's main, the local preview's main, and a wrapper that holds either.
  const block = rules(read(NEON)).find(neonBlock)!;
  assert.deepEqual(selectors(block).map((part) => part.replace(/^:root\s+/, "")), ['.pilot-shell[data-room-theme="neon"]', '#story-workspace[data-room-theme="neon"]', '[data-room-theme="neon"]']);
});

test("neon is defined once: no other stylesheet sets the room's tokens on its container", () => {
  const owners: string[] = [];
  for (const file of readdirSync(join(root, "src"), { recursive: true }).map(String).filter((name) => name.endsWith(".css"))) {
    for (const rule of rules(read(join("src", file)))) if (neonBlock(rule)) owners.push(file);
  }
  assert.deepEqual(owners, ["app/room-theme-neon.css"]);
  assert.match(read("src/app/layout.tsx"), /import "\.\/room-theme-neon\.css";/);
});

test("neon: descendant rules work on main or on a wrapper, and colours are written only in the token block", () => {
  for (const file of NEON_FILES) {
    for (const rule of rules(read(file))) {
      for (const part of selectors(rule)) {
        assert.doesNotMatch(part, /(?:\.pilot-shell|#story-workspace)\[data-room-theme="neon"\]\s+\S/, `${file}: "${part}" only matches when the attribute sits on main; use the bare [data-room-theme="neon"]`);
      }
    }
  }
  for (const file of [NEON, "src/app/room-themes.css"]) {
    for (const rule of rules(read(file))) {
      if (neonBlock(rule)) continue;
      assert.doesNotMatch(rule.body, /#[0-9a-f]{3,8}\b|rgba?\(/i, `${file}: "${rule.selector}" writes a colour; use a token`);
    }
  }
});

test("neon skin: no hard offset shadows, no text-shadow splits, no coloured side border wider than 1px", () => {
  const offending: string[] = [];
  for (const file of NEON_FILES) {
    for (const rule of rules(read(file))) {
      for (const [property, value] of declarations(rule.body)) {
        if (property === "box-shadow" || property === "text-shadow") {
          // Read x, y and blur of each shadow; a var(--glow) or none has no lengths to judge.
          for (const shadow of splitList(value)) {
            const lengths = shadow.replace(/(?:rgba?|hsla?|color-mix)\([^)]*\)/g, "").match(/-?\d*\.?\d+(?:px)?(?=\s|$)/g) ?? [];
            if (lengths.length < 2 || shadow.includes("inset")) continue;
            const [x, y, blur = 0] = lengths.map((length) => parseFloat(length));
            if ((x !== 0 || y !== 0) && blur === 0) offending.push(`${file}: ${rule.selector} { ${property}: ${shadow.trim()} }`);
          }
        }
        if (/^border-(left|right)(-width)?$/.test(property) && /\b([2-9]|\d{2,})px\b/.test(value)) offending.push(`${file}: ${rule.selector} { ${property}: ${value} }`);
      }
    }
  }
  assert.deepEqual(offending, []);
});

test("buttons: danger is a dark fill with its own ink, secondary reserves accent text for text buttons and links", () => {
  const css = rules(read("src/app/globals.css"));
  const only = (selector: string) => declarations(css.find((rule) => rule.selector === selector)?.body ?? "");
  const danger = only(".button.danger");
  assert.equal(danger.get("background"), "var(--danger-fill)");
  assert.equal(danger.get("color"), "var(--on-accent)");
  const secondary = only(".button.secondary");
  assert.equal(secondary.get("color"), "var(--ink)");
  assert.equal(secondary.get("border-color"), "var(--edge)");
  const hover = only(".button.secondary:where(:hover):not(:disabled)");
  assert.equal(hover.get("border-color"), "var(--accent)");
  assert.doesNotMatch(hover.get("background") ?? "", /#/);
});

test("neon: the selection, the focus ring and the placeholder come from the room's tokens", () => {
  const css = rules(read(NEON));
  const find = (needle: string) => css.find((rule) => rule.selector.includes(needle));
  const selection = declarations(find("::selection")!.body);
  assert.equal(selection.get("background"), "var(--selection)");
  assert.equal(selection.get("color"), "var(--ink)");
  assert.equal(declarations(find(":focus-visible")!.body).get("outline-color"), "var(--focus-ring)");
  assert.equal(declarations(find("::placeholder")!.body).get("color"), "var(--muted)");
});
