"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ShieldCheck } from "lucide-react";
import type { Database } from "@/lib/supabase/database.types";
import type { PilotPanel } from "@/lib/pilot";

/**
 * Verified downloads shared by every panel image on the page. The hero and the
 * newest scene card show the same panel, so it is downloaded and hashed once.
 * A failed download is dropped from the cache so a later render can retry.
 */
const verifiedPanels = new Map<string, Promise<Blob>>();

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
    let active = true;
    let objectUrl: string | undefined;
    setUrl(undefined);
    setFailed(false);
    loadVerifiedPanel(client, imagePath, sha256).then(
      (blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
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
