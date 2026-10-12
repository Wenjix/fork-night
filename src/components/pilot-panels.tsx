"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { PilotPanel } from "@/lib/pilot";
import { StoryArt } from "./story-art";

export function PilotImage({
  client,
  panel,
  allowRetry = true,
}: {
  client: SupabaseClient<Database>;
  panel: PilotPanel;
  allowRetry?: boolean;
}) {
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!panel.imagePath) return;
    let active = true,
      objectUrl: string | undefined;
    setUrl(undefined);
    setFailed(false);
    void (async () => {
      const result = await client.storage
        .from("pilot-media")
        .download(panel.imagePath!);
      if (result.error) throw new Error("Image unavailable");
      const hash = await crypto.subtle.digest(
        "SHA-256",
        await result.data.arrayBuffer(),
      );
      const digest = Array.from(new Uint8Array(hash), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      if (digest !== panel.sha256) throw new Error("Image verification failed");
      if (!active) return;
      objectUrl = URL.createObjectURL(result.data);
      setUrl(objectUrl);
    })().catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [client, panel.imagePath, panel.sha256, attempt]);
  if (panel.imageUrl)
    return <StoryArt src={panel.imageUrl} description={panel.caption} />;
  if (url)
    return (
      <img
        className="pilot-image"
        src={url}
        alt={panel.caption}
        width={1024}
        height={1024}
      />
    );
  return (
    <span className="pilot-image-placeholder" role="status">
      {failed ? (
        <>
          Image unavailable.{" "}
          {allowRetry && (
            <button
              type="button"
              className="text-button"
              onClick={() => setAttempt(attempt + 1)}
            >
              Load image again
            </button>
          )}
        </>
      ) : (
        "Loading saved image…"
      )}
    </span>
  );
}

export function PilotPanels({
  client,
  panels,
}: {
  client: SupabaseClient<Database>;
  panels: PilotPanel[];
}) {
  return (
    <div className="pilot-panels" data-panels={panels.length}>
      {panels.map((panel, index) => (
        <figure key={panel.imagePath ?? panel.imageUrl ?? index}>
          <PilotImage client={client} panel={panel} />
          <figcaption>{panel.caption}</figcaption>
        </figure>
      ))}
    </div>
  );
}
