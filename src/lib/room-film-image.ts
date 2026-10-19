import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./supabase/database.types.ts";
import type { RoomFilmShot } from "./room-film.ts";
import { isLocalRasterUrl, LOCAL_RASTER_LIMITS } from "./art.ts";

type Client = SupabaseClient<Database>;

export async function storyboardImage(client: Client, shot: RoomFilmShot, signal: AbortSignal) {
  signal.throwIfAborted();
  if (shot.image) return shot.image;
  if (shot.panel.imageUrl) return shot.panel.imageUrl;
  const result = await client.storage.from("pilot-media").download(shot.panel.imagePath!);
  if (result.error) throw new Error("One source image couldn’t load. Try creating the storyboard again.");
  signal.throwIfAborted();
  if (result.data.size > 4_194_304) throw new Error("One source image is too large. Reload the room before trying again.");
  const bytes = await result.data.arrayBuffer();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== shot.panel.sha256) throw new Error("One source image could not be verified. Reload the room before trying again.");
  signal.throwIfAborted();
  if (bytes.byteLength > LOCAL_RASTER_LIMITS.maxBytes) {
    // Storage accepts 4 MiB; the shared storyboard renderer accepts bounded local rasters.
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/webp" }));
    try {
      signal.throwIfAborted();
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("The source image couldn’t be prepared for the storyboard. Try another browser.");
      while (true) {
        signal.throwIfAborted();
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const image = canvas.toDataURL("image/webp", .82);
        if (isLocalRasterUrl(image)) return image;
        if (canvas.width <= 128 && canvas.height <= 128) throw new Error("The source image couldn’t be prepared for the storyboard. Try another browser.");
        canvas.width = Math.max(1, Math.floor(canvas.width / 2));
        canvas.height = Math.max(1, Math.floor(canvas.height / 2));
      }
    } finally { bitmap.close(); }
  }
  const image = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The source image couldn’t be read. Try again."));
    reader.readAsDataURL(new Blob([bytes], { type: "image/webp" }));
  });
  if (!isLocalRasterUrl(image)) throw new Error("One image is too large for the browser storyboard. Choose another panel.");
  signal.throwIfAborted();
  return image;
}
