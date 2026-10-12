import { memo } from "react";
import {
  artBackgroundSize,
  artPosition,
  artSourceUrl,
  isLocalRasterUrl,
} from "@/lib/art";

export const StoryArt = memo(function StoryArt({
  src,
  description,
  className = "",
}: {
  src: string;
  description: string;
  className?: string;
}) {
  const standalone = isLocalRasterUrl(src);
  return (
    <span
      className={`story-art ${className}`}
      role="img"
      aria-label={description}
    >
      <span
        className="story-art-frame"
        style={{
          backgroundImage: `url(${artSourceUrl(src)})`,
          backgroundPosition: artPosition(src),
          backgroundSize: artBackgroundSize(src),
          backgroundRepeat: "no-repeat",
          ...(standalone
            ? {
                height: "100%",
                top: 0,
                transform: "none",
                aspectRatio: "auto",
              }
            : {}),
        }}
      />
    </span>
  );
});
