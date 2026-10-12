import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types.ts";
import { digest } from "../experiments/storage.ts";

export async function readStored(
  client: SupabaseClient<Database>,
  bucket: "pilot-media" | "pilot-receipts",
  path: string,
): Promise<Buffer | null> {
  const result = await client.storage.from(bucket).download(path);
  if (result.error) {
    const code = (result.error as { statusCode?: string }).statusCode;
    if (code === "404" || result.error.message === "Object not found")
      return null;
    throw new Error("Saved generation data could not be read.");
  }
  return Buffer.from(await result.data.arrayBuffer());
}

export async function saveStored(
  client: SupabaseClient<Database>,
  bucket: "pilot-media" | "pilot-receipts",
  path: string,
  bytes: Buffer,
) {
  const result = await client.storage
    .from(bucket)
    .upload(path, bytes, {
      upsert: false,
      contentType: bucket === "pilot-media" ? "image/webp" : "application/json",
      cacheControl: "0",
    });
  if (result.error) {
    // A prior upload may have succeeded even if its acknowledgement was lost.
    const existing = await readStored(client, bucket, path);
    if (!existing || digest(existing) !== digest(bytes))
      throw new Error("Could not save or verify the generated output.");
  }
  // Delivery is contingent on reading back exactly the bytes saved.
  const saved = await readStored(client, bucket, path);
  if (!saved || digest(saved) !== digest(bytes))
    throw new Error("Stored output verification failed.");
}
