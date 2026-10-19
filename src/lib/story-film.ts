import { isApprovedArtUrl, isLocalRasterUrl, artSourceUrl } from "./art.ts";
import { fixWebmDuration } from "@fix-webm-duration/fix";

export type FilmScene = { id: string; title: string; maker: string; version?: number; panels: { imageUrl: string; caption: string }[] };
export type FilmShot = FilmScene["panels"][number] & { id: string; sourceId: string; title: string; maker: string; sourceVersion?: number };
export type FilmPlan = { title: string; shots: FilmShot[]; secondsPerShot: number };

/** Capture the selected path, so later edits cannot silently change a film being made. */
export function makeFilmPlan(title: string, scenes: FilmScene[]): FilmPlan {
  const shots = scenes.flatMap(scene => scene.panels.map((panel, index) => ({
    ...panel, id: `${scene.id}:${index}`, sourceId: scene.id, title: scene.title, maker: scene.maker,
    ...(scene.version === undefined ? {} : { sourceVersion: scene.version }),
  })));
  if (!shots.length || shots.length > 60) throw new Error("Choose a path with between 1 and 60 panels.");
  return { title, shots, secondsPerShot: 2 };
}

function allowedImage(url: string) {
  return isApprovedArtUrl(url) || isLocalRasterUrl(url) || /^\/(?:world-demo|creator-demo|film-demo)\/[a-z0-9-]+\.webp$/.test(url);
}

async function loadImage(url: string, signal: AbortSignal) {
  if (!allowedImage(url)) throw new Error("A scene's artwork is unavailable. Return to the story and choose its saved image.");
  const image = new Image();
  image.src = isApprovedArtUrl(url) || isLocalRasterUrl(url) ? artSourceUrl(url) : url;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { image.onload = null; image.onerror = null; signal.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(new DOMException("Cancelled", "AbortError")); };
    image.onload = () => { cleanup(); resolve(); };
    image.onerror = () => { cleanup(); reject(new Error("One illustration could not load. Try creating the video again.")); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else if (image.complete && image.naturalWidth) { cleanup(); resolve(); }
  });
  return image;
}

function lines(context: CanvasRenderingContext2D, text: string, width: number) {
  const output: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    // Long unbroken words still fit the frame without dropping caption characters.
    for (const part of word.match(/.{1,50}/gu) ?? [word]) {
      const next = line ? `${line} ${part}` : part;
      if (line && context.measureText(next).width > width) { output.push(line); line = part; }
      else line = next;
    }
  }
  if (line) output.push(line);
  return output;
}

/** A real, silent storyboard video. No external generation request is made. */
export async function renderStoryFilm(plan: FilmPlan, signal: AbortSignal, onProgress: (fraction: number) => void): Promise<Blob> {
  if (typeof MediaRecorder === "undefined" || !HTMLCanvasElement.prototype.captureStream) {
    throw new Error("This browser cannot create the video. Open the story in a browser with video recording support.");
  }
  const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw new Error("This browser has no supported video format. Try another browser.");
  const images = await Promise.all(plan.shots.map(shot => loadImage(shot.imageUrl, signal)));
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  const portrait = matchMedia("(max-width: 700px)").matches;
  canvas.width = portrait ? 720 : 1280; canvas.height = portrait ? 1280 : 720;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The video drawing surface could not open. Try again.");
  const font = getComputedStyle(document.body).fontFamily;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Phone recordings keep real caption/credit sizes instead of shrinking a wide movie.
  // A longer saved caption grows every shot's frame, keeping all words and equal timing.
  context.font = `34px ${font}`;
  const portraitCaptions = portrait ? plan.shots.map(shot => lines(context, shot.caption, 640)) : [];
  if (portrait) canvas.height += (Math.max(6, ...portraitCaptions.map(caption => caption.length)) - 6) * 42;
  const draw = (index: number, fraction: number) => {
    const shot = plan.shots[index], image = images[index];
    let sx = 0, sy = 0, sw = image.naturalWidth, sh = image.naturalHeight;
    if (isApprovedArtUrl(shot.imageUrl)) {
      const frame = Number(shot.imageUrl.match(/=(\d)$/)?.[1] ?? 0);
      sw /= 3; sh /= 2; sx = (frame % 3) * sw; sy = Math.floor(frame / 3) * sh;
    }
    context.fillStyle = "#10162e"; context.fillRect(0, 0, canvas.width, canvas.height);
    if (portrait) {
      const scale = Math.min(640 / sw, 640 / sh) * (reduced ? 1 : 1 + fraction * .025);
      context.save(); context.beginPath(); context.rect(40, 104, 640, 640); context.clip();
      context.drawImage(image, sx, sy, sw, sh, 360 - sw * scale / 2, 424 - sh * scale / 2, sw * scale, sh * scale);
      context.restore();
      context.fillStyle = "#f8f6ff"; context.font = `600 36px ${font}`;
      context.fillText(plan.title, 40, 46, 640);
      context.fillStyle = "#c0c5e0"; context.font = `28px ${font}`;
      context.fillText(`Panel ${index + 1} of ${plan.shots.length}`, 40, 84);
      context.fillStyle = "#f8f6ff"; context.font = `34px ${font}`;
      portraitCaptions[index].forEach((line, i) => context.fillText(line, 40, 790 + i * 42));
      // Reserve the bottom 160px for playback controls, including in downloaded media.
      context.fillStyle = "#d9c7ff"; context.font = `600 32px ${font}`;
      context.fillText(shot.title, 40, canvas.height - 204, 640);
      context.font = `32px ${font}`;
      context.fillText(`Made by ${shot.maker}${shot.sourceVersion === undefined ? "" : ` · v${shot.sourceVersion}`}`, 40, canvas.height - 164, 640);
      return;
    }
    const scale = Math.min(1200 / sw, 490 / sh) * (reduced ? 1 : 1 + fraction * .025);
    context.save(); context.beginPath(); context.rect(40, 56, 1200, 490); context.clip();
    context.drawImage(image, sx, sy, sw, sh, 640 - sw * scale / 2, 301 - sh * scale / 2, sw * scale, sh * scale);
    context.restore();
    context.fillStyle = "#f8f6ff"; context.font = `600 23px ${font}`;
    context.fillText(plan.title, 40, 35, 980);
    context.fillStyle = "#c0c5e0"; context.font = `18px ${font}`;
    context.textAlign = "right"; context.fillText(`${index + 1} / ${plan.shots.length}`, 1240, 35); context.textAlign = "left";
    let size = 25;
    context.font = `${size}px ${font}`;
    let caption = lines(context, shot.caption, 1200);
    while (caption.length * (size + 5) > 113 && size > 12) {
      size--; context.font = `${size}px ${font}`; caption = lines(context, shot.caption, 1200);
    }
    context.fillStyle = "#f8f6ff";
    caption.forEach((line, i) => context.fillText(line, 40, 580 + i * (size + 5)));
    context.fillStyle = "#d9c7ff"; context.font = `16px ${font}`;
    context.fillText(`${shot.title} · ${shot.maker}`, 40, 705, 1200);
  };
  draw(0, 0);
  const stream = canvas.captureStream(24);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
  return new Promise<Blob>((resolve, reject) => {
    const chunks: Blob[] = [];
    let timer: ReturnType<typeof setInterval> | undefined, failure: Error | undefined;
    let start = 0, recordedMs = 0;
    const duration = plan.shots.length * plan.secondsPerShot * 1000;
    const cleanup = () => { clearInterval(timer); signal.removeEventListener("abort", abort); stream.getTracks().forEach(track => track.stop()); };
    const stop = () => { recordedMs = performance.now() - start; recorder.stop(); };
    const abort = () => { failure = new DOMException("Cancelled", "AbortError"); if (recorder.state !== "inactive") stop(); else { cleanup(); reject(failure); } };
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => { failure = new Error("Video creation stopped. Your story is unchanged; try again."); cleanup(); reject(failure); };
    recorder.onstop = async () => {
      cleanup();
      if (failure) { reject(failure); return; }
      if (!chunks.length) { reject(new Error("The video was empty. Try creating it again.")); return; }
      try {
        const raw = new Blob(chunks, { type: recorder.mimeType || mimeType });
        // Canvas recordings omit WebM duration; supply the measured recording interval for seeking.
        const movie = raw.type.startsWith("video/webm") ? await fixWebmDuration(raw, recordedMs, { logger: false }) : raw;
        if (signal.aborted) reject(new DOMException("Cancelled", "AbortError"));
        else resolve(movie);
      } catch {
        reject(new Error("The video could not be finished. Try creating it again."));
      }
    };
    signal.addEventListener("abort", abort, { once: true });
    start = performance.now();
    try { recorder.start(250); } catch { cleanup(); reject(new Error("Video recording could not start. Try another browser.")); return; }
    if (signal.aborted) { abort(); return; }
    timer = setInterval(() => {
      const elapsed = performance.now() - start;
      const index = Math.min(plan.shots.length - 1, Math.floor(elapsed / (plan.secondsPerShot * 1000)));
      draw(index, Math.min(1, (elapsed % (plan.secondsPerShot * 1000)) / (plan.secondsPerShot * 1000)));
      onProgress(Math.min(1, elapsed / duration));
      if (elapsed >= duration) { clearInterval(timer); stop(); }
    }, 1000 / 24);
  });
}
