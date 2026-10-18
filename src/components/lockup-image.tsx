"use client";

import { useEffect, useRef, useState } from "react";

/** True when an image element has finished loading and has something to show. */
export function hasLoaded(image: Pick<HTMLImageElement, "complete" | "naturalWidth">): boolean {
  return image.complete && image.naturalWidth > 0;
}

/**
 * A brand's logotype inside its plate. The file stands in for the brand's name, so while it has not arrived, or if it never does
 * (a failed request, images switched off), the plate spells the name in plain type instead of sitting empty. The image stays in
 * the page, so a slow file still replaces the letters when it lands. Nothing is spelled out until the page has hydrated, so a
 * logo that is already cached never flashes the letters.
 */
export function LockupImage({ src, word, width, height, lazy }: { src: string; word: string; width: number; height: number; lazy?: boolean }) {
  const image = useRef<HTMLImageElement>(null);
  const [spelled, setSpelled] = useState(false);
  useEffect(() => {
    if (image.current) setSpelled(!hasLoaded(image.current));
  }, []);
  return (
    <>
      <img ref={image} src={src} alt="" width={width} height={height} loading={lazy ? "lazy" : undefined} onLoad={() => setSpelled(false)} onError={() => setSpelled(true)} />
      {spelled && <span className="fn-lockup-word">{word}</span>}
    </>
  );
}
