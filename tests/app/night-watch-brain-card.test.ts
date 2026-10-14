import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";
import type { BrainView, JobEvent } from "../../src/night-watch/api-types.ts";
import { BANNED_PHRASES, eventLines, jobTimeline } from "../../src/components/night-watch/api.ts";
import { NIGHT_WATCH_CAPABILITIES } from "../../src/night-watch/identity.ts";

// The Night Watch's brain as the maker meets it in the morning: what it read, its note, the take it
// suggests, and on each candidate why it was planned and what the second brain said. Old jobs show nothing.
const { BrainCard, CandidateThought, PickChip, brainByline, brainExpense, brainFrontFacts, brainPick, brainRecapLine } =
  await tsImport("../../src/components/night-watch/brain-card.tsx", import.meta.url);

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const text = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const planned: BrainView = {
  state: "planned",
  message: "Kimi K3 read the room and planned 3 different takes. Tencent HY4 preview checked them against the world kit and sent 1 back to the plain prompt.",
  planner: { model: "moonshotai/kimi-k3", label: "Kimi K3", latencyMs: 4210 },
  critic: { model: "tencent/hy4-preview", label: "Tencent HY4 preview", latencyMs: 18_400 },
  readOfTheRoom: "Mira has crossed into the Dokkaebi's sea; the story needs the second light to answer.",
  pick: 2,
  morningNote: "I tried three ways for the second lighthouse to answer. B felt truest to the first panel's quiet.",
  candidates: [
    { number: 1, caption: "The far light blinks back.", why: "The simplest answer to the brief.", check: { ok: true, note: "Fits the world's rules." }, plain: false },
    { number: 2, caption: "Mira and the Dokkaebi row toward the second beam.", why: "It moves the story forward.", check: { ok: true, note: "Keeps Mira's scarf and coat." }, plain: false },
    { number: 3, caption: "Mira and the Dokkaebi find a second lighthouse.", why: "", check: { ok: false, note: "It asked for a sign with words on it." }, plain: true },
  ],
  expenseUsd: "0.004812",
};

const plainNight = (overrides: Partial<BrainView> = {}): BrainView => ({
  ...planned,
  state: "plain",
  message: "Kimi K3 did not answer (timed out). The night used the plain prompts.",
  planner: null,
  critic: null,
  readOfTheRoom: null,
  pick: null,
  morningNote: null,
  candidates: planned.candidates.map((candidate) => ({ ...candidate, why: "", check: null, plain: true })),
  expenseUsd: "0.000000",
  ...overrides,
});

const render = (brain: BrainView | null) => renderToStaticMarkup(React.createElement(BrainCard, { brain, titleId: "brain" }));
const banned = (words: string) => {
  for (const phrase of BANNED_PHRASES) assert.doesNotMatch(words, new RegExp(phrase, "i"), phrase);
};

test("the brain card shows what the Night Watch read, its note, its pick and who thought it", () => {
  const html = render(planned);
  const words = text(html);
  assert.match(html, /class="nw-card nw-brain-card" data-state="planned"/);
  assert.match(html, /<h3 id="brain">What your Night Watch thought<\/h3>/);
  assert.match(html, /class="nw-brain-pulse" aria-hidden="true"/, "a calm sign of life, hidden from screen readers");
  assert.match(words, /Read the room: Mira has crossed into the Dokkaebi's sea; the story needs the second light to answer\./);
  assert.match(html, /<blockquote class="nw-brain-note"><p>“I tried three ways for the second lighthouse to answer\. B felt truest to the first panel(&#x27;|')s quiet\.”<\/p>/);
  assert.match(words, /Your Night Watch, after Tencent HY4 preview’s check/);
  assert.match(words, /It suggests starting with candidate B\./);
  assert.match(words, /Planned by Kimi K3 in 4\.2 s · checked by Tencent HY4 preview in 18 s · via TokenRouter · operator-paid inference under \$0\.01/);
  assert.match(words, /It plans and checks before anything is drawn\. It cannot publish: you choose\./);
  banned(words);
});

test("a plain night says so calmly, and a job without a brain shows nothing", () => {
  const quiet = render(plainNight());
  const words = text(quiet);
  assert.match(quiet, /data-state="plain"/);
  assert.match(words, /What your Night Watch thought/);
  assert.match(words, /Kimi K3 did not answer \(timed out\)\. The night used the plain prompts\./);
  assert.doesNotMatch(quiet, /blockquote|nw-brain-pick|nw-brain-pulse|nw-brain-byline/, "no note, pick, pulse or byline when nothing was asked");

  // A planner that answered but whose plan did not pass still shows what it cost.
  const asked = text(render(plainNight({
    message: "Kimi K3 planned, but no take passed the checks, so the night used the plain prompts.",
    planner: { model: "moonshotai/kimi-k3", label: "Kimi K3", latencyMs: 3000 },
    expenseUsd: "0.002400",
  })));
  assert.match(asked, /Asked by Kimi K3 in 3\.0 s · via TokenRouter · operator-paid inference under \$0\.01/);
  banned(asked);

  assert.equal(render(null), "", "old jobs look exactly as before");
});

test("each candidate shows why it was planned, the second brain's check, and the suggested take", () => {
  const thought = (number: number) => text(renderToStaticMarkup(React.createElement(CandidateThought, { thought: planned.candidates[number - 1] })));
  const html2 = renderToStaticMarkup(React.createElement(CandidateThought, { thought: planned.candidates[1] }));
  assert.match(html2, /class="nw-thought-check" data-ok="true"/);
  assert.match(thought(2), /It moves the story forward\. Checked: Keeps Mira's scarf and coat\./);

  const html3 = renderToStaticMarkup(React.createElement(CandidateThought, { thought: planned.candidates[2] }));
  assert.match(html3, /data-plain="true"/);
  assert.match(html3, /class="nw-thought-plain">Plain prompt<\/span>/);
  assert.match(html3, /data-ok="false"/);
  assert.match(thought(3), /Flagged: It asked for a sign with words on it\./);
  assert.doesNotMatch(html3, /nw-thought-why/, "a plain take has no plan to explain");

  assert.equal(renderToStaticMarkup(React.createElement(CandidateThought, { thought: null })), "");
  assert.match(text(renderToStaticMarkup(React.createElement(PickChip))), /^Night Watch suggests starting here$/);
  assert.equal(brainPick(planned), 2);
  assert.equal(brainPick(plainNight({ pick: 2 })), null, "a plain night suggests nothing");
  assert.equal(brainPick(null), null);
});

test("the brain's operator-paid expense never reads as free", () => {
  assert.equal(brainExpense("0.002800"), "under $0.01");
  assert.equal(brainExpense("0.012300"), "≈$0.01");
  assert.equal(brainExpense("0.060000"), "≈$0.06");
  assert.equal(brainExpense("0"), "≈$0.00");
  assert.equal(brainExpense(null), "≈$0.00");
  assert.equal(brainByline({ ...planned, critic: null }), "Planned by Kimi K3 in 4.2 s · via TokenRouter · operator-paid inference under $0.01");
});

test("the morning edition and recap credit the brain without overclaiming", () => {
  assert.deepEqual(brainFrontFacts(planned, 2), ["Planned overnight by Kimi K3, checked by Tencent HY4 preview", "You chose the take your Night Watch suggested first"]);
  assert.deepEqual(brainFrontFacts(planned, 1), ["Planned overnight by Kimi K3, checked by Tencent HY4 preview", "Your Night Watch suggested candidate B; you chose A"]);
  assert.deepEqual(brainFrontFacts(plainNight(), 1), ["Drawn from the plain prompts: the brain did not plan this night"]);
  assert.deepEqual(brainFrontFacts(null, 1), []);
  assert.equal(brainRecapLine(planned), "Night Watch brain: planned by Kimi K3, checked by Tencent HY4 preview (via TokenRouter)");
  assert.equal(brainRecapLine(plainNight()), null);
  assert.equal(brainRecapLine(null), null);
  for (const line of [...brainFrontFacts(planned, 1), brainRecapLine(planned)!]) {
    assert.doesNotMatch(line, /publish(ed|es)? by the Night Watch|Night Watch publish/i, "the brain never publishes");
    banned(line);
  }
});

test("the night log names the brain's step and the timeline places it before the first candidate", () => {
  const at = (minute: number) => `2026-10-14T05:${String(minute).padStart(2, "0")}:00.000Z`;
  const events: JobEvent[] = [
    { at: at(1), step: "scheduled", detail: "Scheduled" },
    { at: at(2), step: "started", detail: "Started" },
    { at: at(3), step: "checked", detail: "Checked room credits: 7 available, 3 needed" },
    { at: at(4), step: "brain", detail: planned.message },
  ];
  assert.equal(eventLines(events).at(-1)!.title, "Read the room and planned the takes");
  assert.equal(eventLines(events).at(-1)!.detail, planned.message);
  for (const detail of [
    "Kimi K3 did not answer (timed out). The night used the plain prompts.",
    "The safety check did not answer, so the night used the plain prompts instead of Kimi K3's plan.",
    "Kimi K3 planned, but no take passed the checks, so the night used the plain prompts.",
  ]) assert.equal(eventLines([{ at: at(4), step: "brain", detail }])[0].title, "Used the plain prompts", detail);
  // A planned night that held one take back is still a planned night.
  assert.equal(eventLines([{ at: at(4), step: "brain", detail: "Kimi K3 read the room and planned 3 different takes. The safety check held back 1, which used the plain prompt." }])[0].title,
    "Read the room and planned the takes");

  const steps = jobTimeline({ state: "generating", events, payment: null });
  assert.equal(steps.find((step) => step.state === "checking")!.status, "done");
  assert.equal(steps.find((step) => step.state === "generating")!.status, "current");
});

test("the agent card lists the brain among the Night Watch's capabilities", () => {
  assert.equal(NIGHT_WATCH_CAPABILITIES[0], "can plan a night with Kimi K3 and have it check its own plan against the world kit (via TokenRouter); otherwise it uses the plain prompts");
  assert.ok(NIGHT_WATCH_CAPABILITIES.includes("prepares private candidates"));
});

test("Act 3 and the morning edition use the brain, and its stylesheet covers every class it draws", () => {
  const away = read("src/components/night-watch/away-panel.tsx");
  assert.match(away, /<BrainCard brain=\{current\.brain\}/);
  assert.match(away, /<CandidateThought thought=\{thought\} \/>/);
  assert.match(away, /data-picked=\{picked \|\| undefined\}/);
  assert.match(away, /\{picked && <PickChip \/>\}/);
  const edition = read("src/components/night-watch/edition-panel.tsx");
  assert.match(edition, /brainFrontFacts\(brain, /);
  assert.match(edition, /brainRecapLine\(brain\)/);
  assert.match(read("src/app/night-watch/page.tsx"), /import "\.\/brain\.css";/);

  const component = read("src/components/night-watch/brain-card.tsx");
  const css = read("src/app/night-watch/brain.css");
  const classes = new Set([...component.matchAll(/className="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/)).filter((name) => /^nw-(brain|thought|pick)/.test(name)));
  assert.ok(classes.size >= 10, `classes: ${[...classes].join(", ")}`);
  for (const name of classes) assert.match(css, new RegExp(`\\.${name}\\b`), `${name} has a rule`);
  banned(component.replace(/BANNED_PHRASES/g, ""));
  banned(css);
});


test("one model that planned and checked reads as one voice", () => {
  const kimi = { model: "moonshotai/kimi-k3", label: "Kimi K3", latencyMs: 4_200 };
  const solo = { ...planned, planner: kimi, critic: { ...kimi, latencyMs: 9_600 } };
  assert.equal(brainByline(solo), "Planned and checked by Kimi K3 in 4.2 s + 9.6 s · via TokenRouter · operator-paid inference under $0.01");
  assert.equal(brainFrontFacts(solo, null)[0], "Planned and checked overnight by Kimi K3");
  assert.equal(brainRecapLine(solo), "Night Watch brain: planned and checked by Kimi K3 (via TokenRouter)");
});


test("a published plain-prompt take is never credited to the brain", () => {
  assert.deepEqual(brainFrontFacts(planned, 3), ["Drawn from the plain prompt: the brain's plan was not used for this take"]);
});
