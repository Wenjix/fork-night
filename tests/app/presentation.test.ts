import test from "node:test";
import assert from "node:assert/strict";
import { createDemoState } from "../../src/domain/fixtures.ts";
import { layoutMoments } from "../../src/lib/map-layout.ts";
import {
  artAssetUrl,
  artPosition,
  isApprovedArtUrl,
} from "../../src/lib/art.ts";
import { renderFinishedHtml } from "../../src/lib/finished-export.ts";
import type { FinishedExport } from "../../src/domain/types.ts";
import { exportBranch, validateDemoState } from "../../src/domain/index.ts";
import {
  createSocialState,
  extendSocialDemo,
  validateSocialState,
} from "../../src/social/model.ts";

test("upward layout puts every child above its parent and all nodes inside bounds", () => {
  const state = createDemoState();
  const { nodes, height, width } = layoutMoments(
    state.moments.filter((m) => m.projectId === "midnight-signal"),
    "seed",
  );
  assert.equal(nodes.length, 6);
  for (const node of nodes) {
    assert.ok(node.x >= 90 && node.x <= width - 90);
    assert.ok(node.y >= 0 && node.y + 145 <= height);
    if (node.moment.parentId)
      assert.ok(
        node.y < nodes.find((n) => n.moment.id === node.moment.parentId)!.y,
      );
  }
});

test("finished HTML is self-contained and escapes contributor-authored text", () => {
  const branch: FinishedExport = {
    format: "fork-night-finished-branch",
    version: 1,
    mode: "local-demo",
    projectTitle: "<script>alert(1)</script>",
    selectedMomentId: "seed",
    termsVersion: "fixture",
    moments: [
      {
        id: "seed",
        version: 1,
        parentId: null,
        title: "A & B",
        panels: [
          {
            imageUrl: "/art/midnight-story.webp#frame=0",
            caption: "<img onerror=alert(1)>",
          },
          {
            imageUrl: "/art/midnight-story.webp#frame=3",
            caption: "A second scene",
          },
        ],
        credit: { name: "Sam" },
        termsVersion: "fixture",
      },
    ],
  };
  const html = renderFinishedHtml(branch, "data:image/webp;base64,YQ==");
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>alert"));
  assert.ok(!html.includes("<img onerror"));
  assert.ok(html.includes("data:image/webp;base64,YQ=="));
  assert.throws(() =>
    renderFinishedHtml(branch, "https://tracker.example/asset"),
  );
});

test("art windows reject invalid frame identifiers", () => {
  assert.equal(artPosition("/art/midnight-story.webp#frame=5"), "100% 100%");
  assert.equal(artPosition("/art/social-worlds.webp#scene=3"), "0% 100%");
  assert.equal(artPosition("/art/social-people.webp#frame=4"), "50% 100%");
  assert.equal(artPosition("#frame=99"), "0% 0%");
  assert.equal(artPosition("#scene=-1"), "0% 0%");
});

test("story panels resolve only the exact packaged sprite sheets, with no remote or path escape", () => {
  for (const sheet of ["midnight-story", "social-worlds", "social-people"]) {
    for (const frameKey of ["frame", "scene"]) {
      const src = `/art/${sheet}.webp#${frameKey}=5`;
      assert.equal(isApprovedArtUrl(src), true);
      assert.equal(artAssetUrl(src), `/art/${sheet}.webp`);
    }
  }
  for (const src of [
    "/art/social-worlds.webp#scene=6",
    "/art/social-worlds.webp#scene=05",
    "/art/social-worlds.webp#scene=0&anything=1",
    "/art/social-worlds.webp?tracking=1#scene=0",
    "https://tracker.example/art/social-worlds.webp#scene=0",
    "//tracker.example/art/social-worlds.webp#scene=0",
    "/art/../private/social-worlds.webp#scene=0",
    "/art/unapproved.webp#frame=0",
    "data:image/svg+xml,<svg/>#frame=0",
  ]) {
    assert.equal(isApprovedArtUrl(src), false);
    assert.throws(() => artAssetUrl(src), /approved local artwork/);
  }
});

test("new fixture stories and board images retain their actual artwork after JSON restore", () => {
  const demo = extendSocialDemo(createDemoState());
  const expected: Record<string, string> = {
    "moon-bus": "/art/social-worlds.webp#scene=0",
    "paper-forest": "/art/social-worlds.webp#scene=5",
    "cloud-garden": "/art/social-people.webp#frame=5",
    "midnight-bakery": "/art/social-worlds.webp#scene=3",
    "lantern-workshop": "/art/social-people.webp#frame=3",
  };
  for (const [id, artwork] of Object.entries(expected)) {
    const project = demo.projects.find((item) => item.id === id)!;
    assert.equal(project.coverUrl, artwork);
    assert.ok(
      demo.moments
        .find((item) => item.id === project.seedId)!
        .panels.every((panel) => panel.imageUrl === artwork),
    );
  }
  assert.doesNotThrow(() =>
    validateDemoState(JSON.parse(JSON.stringify(demo))),
  );
  const social = createSocialState();
  assert.equal(
    social.ideas.find((idea) => idea.id === "tidepool-sketch")!.imageUrl,
    "/art/social-people.webp#frame=4",
  );
  assert.equal(
    social.ideas.find((idea) => idea.id === "tidepool-clouds")!.imageUrl,
    "/art/social-people.webp#frame=5",
  );
  assert.doesNotThrow(() =>
    validateSocialState(JSON.parse(JSON.stringify(social)), demo),
  );
  const malformed = structuredClone(demo);
  malformed.moments[0].panels[0].imageUrl =
    "https://tracker.example/image.webp#frame=0";
  assert.throws(() => validateDemoState(malformed), /invalid/);
});

test("mixed-sheet finished exports embed each sheet once and associate every panel with its own art", () => {
  const demo = extendSocialDemo(createDemoState());
  const branch = exportBranch(demo, {
    userId: "sam",
    projectId: "midnight-signal",
    momentId: "signal",
  });
  branch.moments[0].panels[1].imageUrl = "/art/social-worlds.webp#scene=5";
  branch.moments[1].panels[0].imageUrl = "/art/social-people.webp#frame=4";
  branch.moments[1].credit.thankYou = "<script>alert('credit')</script>";
  const original = "data:image/webp;base64,YQ==";
  const worlds = "data:image/webp;base64,Yg==";
  const people = "data:image/png;base64,Yw==";
  const html = renderFinishedHtml(branch, {
    "/art/midnight-story.webp": original,
    "/art/social-worlds.webp": worlds,
    "/art/social-people.webp": people,
  });
  assert.ok(html.includes(`.art-0{background-image:url(${original})}`));
  assert.ok(html.includes(`.art-1{background-image:url(${worlds})}`));
  assert.ok(html.includes(`.art-2{background-image:url(${people})}`));
  assert.deepEqual(
    [...html.matchAll(/class="image (art-\d)"/g)].map((match) => match[1]),
    ["art-0", "art-1", "art-2", "art-0"],
  );
  for (const data of [original, worlds, people])
    assert.equal(html.split(data).length - 1, 1);
  assert.ok(
    html.includes("&lt;script&gt;alert(&#39;credit&#39;)&lt;/script&gt;"),
  );
  assert.ok(!html.includes("<script>alert"));
  assert.ok(html.includes('style="background-position:100% 100%"'));
});

test("finished exports refuse missing new sheets, unknown sheets and remotely loaded artwork", () => {
  const demo = extendSocialDemo(createDemoState());
  const branch = exportBranch(demo, {
    userId: "sam",
    projectId: "moon-bus",
    momentId: "moon-bus-seed",
  });
  const data = "data:image/webp;base64,YQ==";
  assert.throws(() => renderFinishedHtml(branch, data), /missing/);
  assert.throws(
    () => renderFinishedHtml(branch, { "/art/midnight-story.webp": data }),
    /missing/,
  );
  assert.throws(
    () =>
      renderFinishedHtml(branch, {
        "/art/social-worlds.webp": "https://tracker.example/pixel.png",
      }),
    /embedded local/,
  );
  assert.throws(
    () =>
      renderFinishedHtml(branch, {
        "/art/social-worlds.webp": data,
        "/art/unapproved.webp": data,
      }),
    /unknown artwork/,
  );
  branch.moments[0].panels[0].imageUrl =
    "https://tracker.example/pixel.png#frame=0";
  assert.throws(
    () => renderFinishedHtml(branch, { "/art/social-worlds.webp": data }),
    /approved local artwork/,
  );
});
