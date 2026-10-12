import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertLedgerConservation,
  createDemoState,
  deliverFork,
  DEMO_LIMITS,
  exportBranch,
  getQuote,
  publishFork,
  reserveFork,
  validateDemoState,
} from "../../src/domain/index.ts";
import {
  publishOriginalProject,
  type OriginalProjectInput,
} from "../../src/domain/original-project.ts";
import {
  artAssetUrl,
  artBackgroundSize,
  artPosition,
  artSourceUrl,
  isApprovedArtUrl,
  isLocalRasterUrl,
  isStoryArtUrl,
  LOCAL_RASTER_LIMITS,
} from "../../src/lib/art.ts";
import { renderFinishedHtml } from "../../src/lib/finished-export.ts";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+pT1sAAAAASUVORK5CYII=";
const request: OriginalProjectInput = {
  userId: "sam",
  projectId: "window-garden",
  title: "The garden in the window",
  description: "A seed discovers a room with no floor.",
  panels: [
    { imageUrl: png, caption: "A seed floats past an open window." },
    {
      imageUrl: "/art/social-worlds.webp#scene=5",
      caption: "Inside, a forest is beginning to grow.",
    },
  ],
  now: Date.UTC(2026, 9, 1),
};

test("publishing selected originals creates an open seed with zero eligible reuse cost and no ledger movement", () => {
  const current = createDemoState();
  const unchanged = JSON.stringify(current);
  const next = publishOriginalProject(current, request);
  const project = next.projects.find((item) => item.id === request.projectId)!;
  const seed = next.moments.find((item) => item.id === project.seedId)!;
  assert.equal(project.visibility, "open");
  assert.equal(project.groupId, null);
  assert.equal(project.coverUrl, png);
  assert.equal(seed.id, `${request.projectId}-seed`);
  assert.equal(seed.parentId, null);
  assert.equal(seed.source, "local-original");
  assert.equal(seed.reuseFee, 0);
  assert.equal(seed.authorId, request.userId);
  assert.deepEqual(seed.panels, request.panels);
  for (const key of [
    "accounts",
    "operations",
    "ledger",
    "claims",
    "generationSpent",
    "memberships",
  ] as const)
    assert.deepEqual(next[key], current[key]);
  assert.equal(JSON.stringify(current), unchanged);
  assert.doesNotThrow(() =>
    validateDemoState(JSON.parse(JSON.stringify(next))),
  );
  assert.doesNotThrow(() => assertLedgerConservation(next));
});

test("exact original publication retries are idempotent; an identity cannot be reused with altered work", () => {
  const published = publishOriginalProject(createDemoState(), request);
  assert.equal(publishOriginalProject(published, request), published);
  assert.equal(
    publishOriginalProject(published, { ...request, now: request.now! + 1 }),
    published,
  );
  for (const changed of [
    { ...request, title: `${request.title} ` },
    { ...request, description: "A different story." },
    { ...request, userId: "priya" },
    { ...request, panels: [...request.panels].reverse() },
    {
      ...request,
      panels: [
        { ...request.panels[0], caption: "Another caption" },
        request.panels[1],
      ],
    },
  ])
    assert.throws(
      () => publishOriginalProject(published, changed as OriginalProjectInput),
      /different work/,
    );
  assert.throws(
    () =>
      publishOriginalProject(createDemoState(), {
        ...request,
        projectId: "midnight-signal",
      }),
    /different work/,
  );
  assert.equal(
    published.projects.filter((project) => project.id === request.projectId)
      .length,
    1,
  );
});

test("inherited work, private context and unselected card metadata cannot become an original seed", () => {
  const state = createDemoState();
  for (const context of [
    { projectId: "midnight-signal", momentId: "sea" },
    { projectId: "tidepool", momentId: "tidepool-lantern" },
  ]) {
    assert.throws(
      () =>
        publishOriginalProject(state, {
          ...request,
          panels: [{ ...request.panels[0], context }, request.panels[1]],
        }),
      /Inherited work/,
    );
    assert.throws(
      () =>
        publishOriginalProject(state, {
          ...request,
          context,
        } as OriginalProjectInput),
      /Inherited work/,
    );
  }
  assert.throws(
    () =>
      publishOriginalProject(state, {
        ...request,
        panels: [
          { ...request.panels[0], notes: "private canvas notes" },
          request.panels[1],
        ],
      } as unknown as OriginalProjectInput),
    /selected artwork/,
  );
  for (const changed of [
    { ...request, userId: "unknown" },
    { ...request, title: " " },
    { ...request, description: "" },
    { ...request, panels: [request.panels[0]] },
    { ...request, panels: [request.panels[0], ,] },
    { ...request, now: Infinity },
  ])
    assert.throws(() =>
      publishOriginalProject(state, changed as OriginalProjectInput),
    );
});

test("original seed validation cannot claim paid costs, become a paid child, or replace private ancestry", () => {
  for (const mutate of [
    (seed: ReturnType<typeof createDemoState>["moments"][number]) => {
      seed.reuseFee = 120_000;
    },
    (seed: ReturnType<typeof createDemoState>["moments"][number]) => {
      seed.authorId = "priya";
      seed.beneficiaryId = "priya";
    },
    (seed: ReturnType<typeof createDemoState>["moments"][number]) => {
      seed.version = 2;
    },
    (seed: ReturnType<typeof createDemoState>["moments"][number]) => {
      seed.builtOnThanks = "Paid ancestry flattened";
    },
  ]) {
    const next = publishOriginalProject(createDemoState(), request);
    mutate(next.moments.at(-1)!);
    assert.throws(() => validateDemoState(next), /original seed/);
  }
  const privateSeed = createDemoState();
  privateSeed.moments.find((moment) => moment.id === "tidepool-seed")!.source =
    "local-original";
  assert.throws(() => validateDemoState(privateSeed), /original seed/);
  const child = createDemoState();
  child.moments.find((moment) => moment.id === "sea")!.source =
    "local-original";
  assert.throws(() => validateDemoState(child), /original seed/);
});

test("new originals are forkable through the existing paid lifecycle without changing paid ancestry", () => {
  const current = createDemoState();
  const prior = getQuote(current, {
    userId: "priya",
    projectId: "midnight-signal",
    parentId: "sea",
    prompt: "Keep the light burning.",
    now: request.now,
  });
  let next = publishOriginalProject(current, request);
  assert.deepEqual(
    getQuote(next, {
      userId: "priya",
      projectId: "midnight-signal",
      parentId: "sea",
      prompt: "Keep the light burning.",
      now: request.now,
    }),
    prior,
  );
  const quote = getQuote(next, {
    userId: "priya",
    projectId: request.projectId,
    parentId: `${request.projectId}-seed`,
    prompt: "Let the branches reach the clouds.",
    now: request.now,
  });
  assert.equal(quote.upstreamTotal, 0);
  assert.equal(quote.totalMax, DEMO_LIMITS.generationMax);
  assert.deepEqual(
    quote.ancestorFees.map((fee) => fee.amount),
    [0],
  );
  next = reserveFork(next, quote, { now: request.now });
  next = deliverFork(next, `op-${quote.id}`);
  next = publishFork(next, `op-${quote.id}`, "Thanks for the seed.", {
    now: request.now! + 1,
  });
  assert.doesNotThrow(() => validateDemoState(next));
  const operation = next.operations.at(-1)!;
  assert.equal(operation.settledAmount, DEMO_LIMITS.generationActual);
  const followup = getQuote(next, {
    userId: "jules",
    projectId: request.projectId,
    parentId: operation.publishedMomentId!,
    prompt: "A bird brings a tiny key.",
    now: request.now! + 2,
  });
  assert.equal(followup.upstreamTotal, DEMO_LIMITS.generationActual);
  assert.deepEqual(
    followup.ancestorFees.map((fee) => fee.amount),
    [0, DEMO_LIMITS.generationActual],
  );
  assert.equal(
    exportBranch(next, {
      userId: "jules",
      projectId: request.projectId,
      momentId: operation.publishedMomentId!,
    }).moments.length,
    2,
  );
});

test("standalone rasters render whole and export with approved sheets, without canvas or membership fields", () => {
  assert.equal(isLocalRasterUrl(png), true);
  assert.equal(isStoryArtUrl(png), true);
  assert.equal(isApprovedArtUrl(png), false);
  assert.equal(artSourceUrl(png), png);
  assert.equal(artBackgroundSize(png), "contain");
  assert.equal(artPosition(png), "center");
  assert.throws(() => artAssetUrl(png), /approved local artwork/);
  const next = publishOriginalProject(createDemoState(), request);
  const branch = exportBranch(next, {
    userId: "jules",
    projectId: request.projectId,
    momentId: `${request.projectId}-seed`,
  });
  const exported = JSON.stringify(branch);
  for (const field of [
    "boards",
    "ownerId",
    "memberships",
    "operations",
    "ledger",
    "claims",
    "storyContext",
  ])
    assert.equal(exported.includes(`"${field}"`), false);
  const html = renderFinishedHtml(branch, {
    "/art/social-worlds.webp": "data:image/webp;base64,YQ==",
  });
  assert.ok(
    html.includes(`background-image:url(${png});background-size:contain`),
  );
  assert.ok(html.includes('style="background-position:center"'));
  assert.ok(html.includes('style="background-position:100% 100%"'));
  assert.throws(() => renderFinishedHtml(branch, {}), /missing/);
  const onlyRasters = structuredClone(branch);
  onlyRasters.moments[0].panels[1].imageUrl = png;
  assert.doesNotThrow(() => renderFinishedHtml(onlyRasters, {}));
});

test("raster media rejects remote URLs, SVG disguises, malformed base64 and oversized imports", () => {
  const webp = `data:image/webp;base64,${readFileSync(new URL("../../public/art/midnight-story.webp", import.meta.url)).toString("base64")}`;
  assert.equal(isLocalRasterUrl(webp), true);
  const unsafe = [
    "https://example.com/image.png",
    "//example.com/image.png",
    "data:image/svg+xml;base64,PHN2Zy8+",
    "data:image/png;base64,PHN2Zy8+",
    "data:image/jpeg;base64,PHN2Zy8+",
    png.replace("image/png", "image/gif"),
    png.replace("image/png", "image/jpeg"),
    `${png}\n`,
    `${png}#frame=1`,
    png.slice(0, -1),
    `data:image/png;base64,${"A".repeat(LOCAL_RASTER_LIMITS.maxUrlLength)}`,
  ];
  for (const src of unsafe) {
    assert.equal(isStoryArtUrl(src), false);
    assert.throws(() => artSourceUrl(src));
    assert.throws(
      () =>
        publishOriginalProject(createDemoState(), {
          ...request,
          panels: [
            { imageUrl: src, caption: "Unsafe media" },
            request.panels[1],
          ],
        }),
      /PNG, JPEG or WebP/,
    );
  }
  const malformed = publishOriginalProject(createDemoState(), request);
  malformed.moments.at(-1)!.panels[0].imageUrl = unsafe[0];
  assert.throws(() => validateDemoState(malformed));
});
