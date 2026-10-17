import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types.ts";

const { PilotArtwork } = await tsImport("../../src/components/pilot-artwork.tsx", import.meta.url);

const client = {} as SupabaseClient<Database>;

test("panel captions are hidden when they repeat the moment title", () => {
  const html = renderToStaticMarkup(createElement(PilotArtwork, {
    client,
    title: "The cat wakes up",
    maker: "Tester",
    panels: [{ caption: "The cat wakes up", imageUrl: "/art/midnight-story.webp#frame=1" }],
  }));
  assert.doesNotMatch(html, /<figcaption>The cat wakes up<\/figcaption>/);
  const distinct = renderToStaticMarkup(createElement(PilotArtwork, {
    client,
    title: "The cat wakes up",
    maker: "Tester",
    panels: [{ caption: "A radio crackles outside.", imageUrl: "/art/midnight-story.webp#frame=1" }],
  }));
  assert.match(distinct, /<figcaption>A radio crackles outside\.<\/figcaption>/);
});
