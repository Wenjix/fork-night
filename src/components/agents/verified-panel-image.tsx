"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ShieldCheck } from "lucide-react";
import type { Database } from "@/lib/supabase/database.types";
import type { PilotPanel } from "@/lib/pilot";

/**
 * Verified downloads shared by every panel image on the page. The hero and the
 * newest scene card show the same panel, so it is downloaded and hashed once.
 * A failed download is dropped from the cache so the image's next try
 * downloads it again.
 */
const verifiedPanels = new Map<string, Promise<Blob>>();

/** A failed download is tried again this many times, this far apart. A hash mismatch is final. */
export const PANEL_RETRIES = 3;
export const PANEL_RETRY_MS = 15_000;

export function loadVerifiedPanel(
  client: SupabaseClient<Database>,
  imagePath: string,
  sha256: string,
): Promise<Blob> {
  const key = `${imagePath}#${sha256}`;
  const cached = verifiedPanels.get(key);
  if (cached) return cached;
  const pending = (async () => {
    const result = await client.storage.from("pilot-media").download(imagePath);
    if (result.error) throw new Error("Image unavailable");
    const hash = await crypto.subtle.digest(
      "SHA-256",
      await result.data.arrayBuffer(),
    );
    const digest = Array.from(new Uint8Array(hash), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    if (digest !== sha256) throw new Error("Hash mismatch");
    return result.data;
  })();
  verifiedPanels.set(key, pending);
  pending.catch(() => verifiedPanels.delete(key));
  return pending;
}

/**
 * Loads a verified panel, trying a failed download again up to PANEL_RETRIES
 * times. Returns a function that stops the callbacks and any retry still waiting.
 */
export function loadVerifiedPanelWithRetry(
  client: SupabaseClient<Database>,
  imagePath: string,
  sha256: string,
  onLoad: (blob: Blob) => void,
  onFail: () => void,
): () => void {
  let active = true;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const attempt = (retriesLeft: number) =>
    loadVerifiedPanel(client, imagePath, sha256).then(
      (blob) => {
        if (active) onLoad(blob);
      },
      (error: unknown) => {
        if (!active) return;
        onFail();
        const mismatch = error instanceof Error && error.message === "Hash mismatch";
        if (retriesLeft > 0 && !mismatch)
          retry = setTimeout(() => attempt(retriesLeft - 1), PANEL_RETRY_MS);
      },
    );
  void attempt(PANEL_RETRIES);
  return () => {
    active = false;
    clearTimeout(retry);
  };
}

/**
 * Downloads a published panel from `pilot-media` (readable by any guest) and
 * shows it only when its SHA-256 matches the hash saved with the scene,
 * the same check the room and Wren's own preview step make.
 *
 * Every use sits in a figure whose figcaption is the panel's caption, so the
 * image itself has empty alt text and screen readers hear the caption once.
 */
export function VerifiedPanelImage({
  client,
  panel,
}: {
  client: SupabaseClient<Database>;
  panel: PilotPanel;
}) {
  const { imagePath, sha256 } = panel;
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!imagePath || !sha256) {
      setFailed(true);
      return;
    }
    let objectUrl: string | undefined;
    setUrl(undefined);
    setFailed(false);
    // Retries keep "Image unavailable" up until one succeeds; polling never re-runs this.
    const stop = loadVerifiedPanelWithRetry(
      client,
      imagePath,
      sha256,
      (blob) => {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      },
      () => setFailed(true),
    );
    return () => {
      stop();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [client, imagePath, sha256]);

  if (url)
    return (
      <span className="ag-panel-frame">
        <img src={url} alt="" width={1024} height={1024} decoding="async" />
        <span
          className="ag-hash-chip"
          title={`SHA-256 ${sha256}`}
        >
          <ShieldCheck size={13} aria-hidden="true" />
          Hash matches
        </span>
      </span>
    );
  return (
    <span className="ag-panel-frame ag-panel-placeholder" role="status">
      {failed ? "Image unavailable" : "Checking image…"}
    </span>
  );
}
