import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BLADE_RUNNER_RESTYLE as restyle, restyledImage, restyledMoment } from "../../src/lib/prepared-restyle.ts";
import { isApprovedArtUrl } from "../../src/lib/art.ts";
import { createDemoState } from "../../src/domain/fixtures.ts";
import { extendFandomDemo } from "../../src/domain/fandom-fixtures.ts";
import { extendSocialDemo } from "../../src/social/model.ts";
import { getPath } from "../../src/domain/index.ts";

test("the prepared restyle swaps only the archive path's three frames and never the saved story", () => {
  const state = extendFandomDemo(extendSocialDemo(createDemoState()));
  const before = JSON.stringify(state);
  const path = getPath(state, restyle.projectId, restyle.momentIds[1]);
  assert.deepEqual(path.map(moment => moment.id), restyle.frames.map(item => item.momentId));
  for (const [index, moment] of path.entries()) {
    const shown = restyledMoment(moment);
    assert.equal(shown.panels[0].imageUrl, `${restyle.restyled}#frame=${restyle.frames[index].frame}`);
    assert(isApprovedArtUrl(shown.panels[0].imageUrl));
    assert.deepEqual(shown.panels.map(panel => panel.caption), moment.panels.map(panel => panel.caption));
  }
  // The opening's second frame and the other forks keep their original art.
  for (const frame of [1, 2, 3]) assert.equal(restyledImage(`${restyle.source}#frame=${frame}`), `${restyle.source}#frame=${frame}`);
  assert.equal(restyledImage("/art/blade-runner-film.webp#frame=0"), "/art/blade-runner-film.webp#frame=0");
  const other = state.moments.find(moment => moment.projectId !== restyle.projectId)!;
  assert.strictEqual(restyledMoment(other), other);
  assert.equal(JSON.stringify(state), before);
  const allowlist = readFileSync(new URL("../../config/submission-files.json", import.meta.url), "utf8");
  assert(allowlist.includes(`"public${restyle.restyled}"`));
});
