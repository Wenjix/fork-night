"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Download } from "lucide-react";
import type { WorldPanel } from "../../night-watch/api-types.ts";
import { isApprovedArtUrl } from "../../lib/art.ts";
import { displayImageUrl, errorMessage, recapFileName, type RecapModel } from "./api.ts";

/** An exportable recap card: the edition's moment, makers and receipts, drawn on a canvas. */

const WIDTH = 1200;
const HEIGHT = 630;
const PAD = 56;
const ART = HEIGHT - PAD * 2;

type ArtSource = { src: string; frame: number | null; crossOrigin: boolean };

function artSource(panel: WorldPanel | null): ArtSource | null {
  if (!panel?.imageUrl) return null;
  if (isApprovedArtUrl(panel.imageUrl)) {
    const [src, fragment] = panel.imageUrl.split("#");
    return { src, frame: Number(fragment.split("=")[1] ?? 0), crossOrigin: false };
  }
  const url = displayImageUrl(panel.imageUrl);
  return url ? { src: url, frame: null, crossOrigin: !url.startsWith("/") } : null;
}

function loadImage(source: ArtSource) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    if (source.crossOrigin) image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The recap image could not load."));
    image.src = source.src;
  });
}

function wrap(context: CanvasRenderingContext2D, text: string, width: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (context.measureText(next).width <= width || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last.length > 1 && context.measureText(`${last}…`).width > width) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last.trimEnd()}…`;
  return kept;
}

function family(selector: string) {
  const element = document.querySelector(selector) ?? document.body;
  return getComputedStyle(element).fontFamily || "sans-serif";
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function drawArt(context: CanvasRenderingContext2D, image: HTMLImageElement | null, frame: number | null) {
  context.save();
  roundedRect(context, PAD, PAD, ART, ART, 22);
  context.clip();
  context.fillStyle = "#222746";
  context.fillRect(PAD, PAD, ART, ART);
  if (image) {
    // Sprite sheets are 3 x 2 frames; crop the frame, then a centered square.
    let cellX = 0;
    let cellY = 0;
    let cellWidth = image.naturalWidth;
    let cellHeight = image.naturalHeight;
    if (frame !== null) {
      cellWidth = image.naturalWidth / 3;
      cellHeight = image.naturalHeight / 2;
      cellX = (frame % 3) * cellWidth;
      cellY = Math.floor(frame / 3) * cellHeight;
    }
    const side = Math.min(cellWidth, cellHeight);
    context.drawImage(image, cellX + (cellWidth - side) / 2, cellY + (cellHeight - side) / 2, side, side, PAD, PAD, ART, ART);
  } else {
    context.fillStyle = "#c0c5e0";
    context.font = `500 20px ${family("body")}`;
    context.fillText("The morning edition", PAD + 32, PAD + ART / 2);
  }
  context.restore();
  context.strokeStyle = "rgba(255, 219, 103, 0.55)";
  context.lineWidth = 2;
  roundedRect(context, PAD, PAD, ART, ART, 22);
  context.stroke();
}

function drawCard(canvas: HTMLCanvasElement, model: RecapModel, image: HTMLImageElement | null, frame: number | null) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot draw the recap card.");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const sky = context.createLinearGradient(0, 0, 0, HEIGHT);
  sky.addColorStop(0, "#0b1024");
  sky.addColorStop(0.6, "#1b2150");
  sky.addColorStop(1, "#43396a");
  context.fillStyle = sky;
  context.fillRect(0, 0, WIDTH, HEIGHT);
  const dawn = context.createRadialGradient(WIDTH * 0.8, HEIGHT * 1.1, 10, WIDTH * 0.8, HEIGHT * 1.1, 560);
  dawn.addColorStop(0, "rgba(255, 219, 103, 0.5)");
  dawn.addColorStop(1, "rgba(255, 219, 103, 0)");
  context.fillStyle = dawn;
  context.fillRect(0, 0, WIDTH, HEIGHT);
  for (let star = 0; star < 64; star++) {
    const x = (star * 157.3 + 31) % WIDTH;
    const y = (star * 83.7 + 17) % (HEIGHT * 0.72);
    context.fillStyle = star % 7 === 0 ? "rgba(255, 219, 103, 0.85)" : "rgba(255, 255, 255, 0.55)";
    context.beginPath();
    context.arc(x, y, star % 5 === 0 ? 1.7 : 1, 0, Math.PI * 2);
    context.fill();
  }
  drawArt(context, image, frame);

  const body = family("body");
  const display = family(".night-watch h2");
  const x = PAD + ART + 48;
  const width = WIDTH - x - PAD;
  let y = PAD + 14;
  context.textBaseline = "top";
  context.fillStyle = "#ffdb67";
  context.font = `700 15px ${body}`;
  context.fillText(model.eyebrow, x, y);
  y += 34;
  context.fillStyle = "#f8f6ff";
  context.font = `700 42px ${display}`;
  for (const line of wrap(context, model.title, width, 3)) {
    context.fillText(line, x, y);
    y += 50;
  }
  context.fillStyle = "#c0c5e0";
  context.font = `500 18px ${body}`;
  context.fillText(model.byline, x, y + 4);
  y += 46;
  context.font = `500 16px ${body}`;
  const bottom = HEIGHT - PAD - 28;
  for (const text of model.lines) {
    const lines = wrap(context, text, width - 18, 2);
    if (y + lines.length * 22 > bottom) break;
    context.fillStyle = "#ffdb67";
    context.fillRect(x, y + 8, 6, 6);
    context.fillStyle = "#dfe2f5";
    for (const line of lines) {
      context.fillText(line, x + 18, y);
      y += 22;
    }
    y += 7;
  }
  context.fillStyle = "#9ea4c9";
  context.font = `500 14px ${body}`;
  context.fillText(model.footer, x, HEIGHT - PAD - 14);
}

function toPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The recap card could not be exported."))), "image/png");
    } catch (error) {
      reject(error);
    }
  });
}

export function RecapCard({ model, panel }: { model: RecapModel; panel: WorldPanel | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const ids = useId();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const source = artSource(panel);
  const key = JSON.stringify([model, source]);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let active = true;
    void (async () => {
      await document.fonts?.ready;
      const image = source ? await loadImage(source).catch(() => null) : null;
      if (active) drawCard(element, model, image, source?.frame ?? null);
    })().catch((reason) => {
      if (active) setError(errorMessage(reason, "The recap card could not be drawn in this browser."));
    });
    return () => {
      active = false;
    };
    // The serialized key covers the model and image source.
  }, [key]);

  async function download() {
    const element = canvas.current;
    if (!element || saving) return;
    setSaving(true);
    setError("");
    try {
      let blob: Blob;
      try {
        blob = await toPng(element);
      } catch {
        // A cross-origin image without CORS taints the canvas; export the card without it.
        drawCard(element, model, null, null);
        blob = await toPng(element);
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = recapFileName(model.title);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (reason) {
      setError(errorMessage(reason, "The recap card could not be exported."));
    } finally {
      setSaving(false);
    }
  }

  return <section className="nw-card nw-recap" aria-labelledby={`${ids}-recap`}>
    <div className="nw-card-head">
      <h3 id={`${ids}-recap`}>Recap card</h3>
      <button type="button" className="button secondary" disabled={saving} onClick={() => void download()}><Download size={16} aria-hidden="true" />{saving ? "Preparing…" : "Download PNG"}</button>
    </div>
    <canvas ref={canvas} width={WIDTH} height={HEIGHT} className="nw-recap-canvas" role="img"
      aria-label={`Recap card. ${model.title}, ${model.byline}. ${model.lines.join(". ")}. ${model.footer}`} />
    <p className="nw-fine">For sharing the edition: its moment, makers and receipts. It is a picture of public testnet records, not a record itself.</p>
    {error && <p role="alert" className="nw-error">{error}</p>}
  </section>;
}
