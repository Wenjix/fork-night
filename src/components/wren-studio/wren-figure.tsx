import { describeLook, yarn, type WrenLook } from "@/lib/wren-look";

const INK = "#2f2620";
const BEAK = { base: "#e5a33c", shade: "#b97a1f" };
const LEAF = "#6f8a58";

function Eye({ x, face, stitch }: { x: number; face: WrenLook["face"]; stitch: string }) {
  return <g transform={`translate(${x} 122)`}>
    {face === "sleepy" && <path d="M-9 -1 Q0 7 9 -1" fill="none" stroke={INK} strokeWidth="3.4" strokeLinecap="round" />}
    {face === "button" && <>
      <circle r="8.5" fill={INK} />
      <circle r="6" fill="none" stroke={stitch} strokeOpacity="0.35" strokeWidth="1" />
      <g fill={stitch} fillOpacity="0.8">
        <circle cx="-2.2" cy="-2.2" r="1.2" /><circle cx="2.2" cy="-2.2" r="1.2" />
        <circle cx="-2.2" cy="2.2" r="1.2" /><circle cx="2.2" cy="2.2" r="1.2" />
      </g>
      <circle cx="-4" cy="-4.5" r="1.6" fill="#fff" fillOpacity="0.7" />
    </>}
    {face === "bright" && <>
      <circle r="9" fill={INK} />
      <circle cx="-3" cy="-3.5" r="3" fill="#fff" />
    </>}
    {face === "sparkle" && <>
      <circle r="9.5" fill={INK} />
      <path d="M-2 -7 L-0.6 -3.6 L3 -2.2 L-0.6 -0.8 L-2 2.6 L-3.4 -0.8 L-7 -2.2 L-3.4 -3.6 Z" fill="#fff" />
      <circle cx="4" cy="4" r="1.6" fill="#fff" />
    </>}
  </g>;
}

/** Wren as a plush, knitted bird. Pure and deterministic, so the preview and any saved card match. */
export function WrenFigure({ look, idPrefix, className = "" }: { look: WrenLook; idPrefix: string; className?: string }) {
  const main = yarn(look.yarn);
  const trim = yarn(look.accent);
  const id = (name: string) => `${idPrefix}-${name}`;
  const ref = (name: string) => `url(#${id(name)})`;
  const hat = look.accessory === "beanie";
  return <svg className={`wren-figure ${className}`} viewBox="0 0 240 260" role="img" aria-label={describeLook(look)}>
    <defs>
      <clipPath id={id("body")}><ellipse cx="120" cy="150" rx="74" ry="80" /></clipPath>
      <clipPath id={id("belly")}><ellipse cx="120" cy="176" rx="44" ry="46" /></clipPath>
      <radialGradient id={id("light")} cx="38%" cy="30%" r="75%">
        <stop offset="0" stopColor="#fff" stopOpacity="0.32" />
        <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
        <stop offset="1" stopColor="#3a2414" stopOpacity="0.22" />
      </radialGradient>
      <pattern id={id("knit")} width="12" height="10" patternUnits="userSpaceOnUse">
        <path d="M0 1 L6 9 L12 1" fill="none" stroke={main.shade} strokeOpacity="0.45" strokeWidth="1.7" strokeLinecap="round" />
      </pattern>
      <pattern id={id("knit-trim")} width="10" height="9" patternUnits="userSpaceOnUse">
        <path d="M0 1 L5 8 L10 1" fill="none" stroke={trim.shade} strokeOpacity="0.45" strokeWidth="1.5" strokeLinecap="round" />
      </pattern>
      <pattern id={id("stripes")} width="20" height="28" patternUnits="userSpaceOnUse">
        <rect y="14" width="20" height="14" fill={trim.base} />
      </pattern>
      <pattern id={id("speckle")} width="26" height="24" patternUnits="userSpaceOnUse">
        <circle cx="5" cy="6" r="2.2" fill={trim.light} />
        <circle cx="18" cy="15" r="1.8" fill={trim.shade} />
        <circle cx="11" cy="20" r="1.4" fill={trim.light} />
      </pattern>
    </defs>

    <ellipse cx="120" cy="240" rx="70" ry="9" fill="#5a3a1e" opacity="0.2" />

    <g className="wren-figure-body">
      <rect x="96" y="220" width="15" height="16" rx="6" fill={BEAK.shade} />
      <rect x="129" y="220" width="15" height="16" rx="6" fill={BEAK.shade} />
      <path d="M62 178 Q30 196 40 222 Q68 210 84 192 Z" fill={main.shade} />

      {!hat && <g fill={main.shade}>
        <ellipse cx="112" cy="70" rx="7" ry="15" transform="rotate(-24 112 70)" />
        <ellipse cx="122" cy="66" rx="7" ry="17" />
        <ellipse cx="132" cy="71" rx="6" ry="13" transform="rotate(26 132 71)" />
      </g>}

      <ellipse cx="120" cy="150" rx="74" ry="80" fill={main.base} />
      <g clipPath={ref("body")}>
        {look.pattern === "stripes" && <rect x="40" y="60" width="160" height="180" fill={ref("stripes")} />}
        {look.pattern === "speckle" && <rect x="40" y="60" width="160" height="180" fill={ref("speckle")} />}
        {look.pattern === "patchwork" && <>
          <rect x="40" y="60" width="80" height="90" fill={trim.base} />
          <rect x="120" y="150" width="80" height="90" fill={trim.light} />
          <path d="M120 60 V240 M40 150 H200" stroke={main.shade} strokeWidth="2" strokeDasharray="4 5" fill="none" />
        </>}
        <rect x="40" y="60" width="160" height="180" fill={ref("knit")} />
        <ellipse cx="120" cy="150" rx="74" ry="80" fill={ref("light")} />
      </g>

      <ellipse cx="54" cy="160" rx="17" ry="36" transform="rotate(16 54 160)" fill={main.shade} />
      <ellipse cx="186" cy="160" rx="17" ry="36" transform="rotate(-16 186 160)" fill={main.shade} />

      <ellipse cx="120" cy="176" rx="44" ry="46" fill={trim.light} />
      <g clipPath={ref("belly")}><rect x="70" y="128" width="100" height="100" fill={ref("knit-trim")} /></g>
      <ellipse cx="120" cy="176" rx="44" ry="46" fill="none" stroke={main.shade} strokeWidth="2" strokeDasharray="3 5" strokeLinecap="round" />

      <circle cx="88" cy="142" r="8" fill="#d9705a" opacity="0.32" />
      <circle cx="152" cy="142" r="8" fill="#d9705a" opacity="0.32" />
      <Eye x={98} face={look.face} stitch={trim.light} />
      <Eye x={142} face={look.face} stitch={trim.light} />
      <path d="M109 136 Q120 127 131 136 Q120 151 109 136 Z" fill={BEAK.base} />
      <path d="M110 137 Q120 141 130 137" fill="none" stroke={BEAK.shade} strokeWidth="1.6" strokeLinecap="round" />

      {look.accessory === "glasses" && <g fill="#fff" fillOpacity="0.14" stroke={INK} strokeWidth="3">
        <circle cx="98" cy="122" r="15" />
        <circle cx="142" cy="122" r="15" />
        <path d="M113 120 Q120 115 127 120" fill="none" />
      </g>}
      {look.accessory === "scarf" && <g>
        <path d="M58 150 Q120 176 182 150 L184 166 Q120 194 56 166 Z" fill={trim.base} />
        <path d="M58 150 Q120 176 182 150 L184 166 Q120 194 56 166 Z" fill={ref("knit-trim")} />
        <path d="M146 170 L160 214 L146 218 L136 176 Z" fill={trim.shade} />
        <path d="M148 216 v8 M153 214 v8 M158 212 v8" stroke={trim.shade} strokeWidth="2" strokeLinecap="round" />
      </g>}
      {look.accessory === "bowtie" && <g fill={trim.base} stroke={trim.shade} strokeWidth="1.5" strokeLinejoin="round">
        <path d="M120 162 L98 150 L98 174 Z" />
        <path d="M120 162 L142 150 L142 174 Z" />
        <circle cx="120" cy="162" r="5.5" fill={trim.shade} />
      </g>}
      {hat && <g>
        <path d="M58 104 Q62 52 120 48 Q178 52 182 104 Z" fill={trim.base} />
        <path d="M58 104 Q62 52 120 48 Q178 52 182 104 Z" fill={ref("knit-trim")} />
        <rect x="52" y="94" width="136" height="18" rx="9" fill={trim.shade} />
        <path d="M64 96 v14 M76 96 v14 M88 96 v14 M100 96 v14 M112 96 v14 M124 96 v14 M136 96 v14 M148 96 v14 M160 96 v14 M172 96 v14" stroke={trim.base} strokeOpacity="0.5" strokeWidth="2" />
        <circle cx="120" cy="44" r="13" fill={trim.light} />
      </g>}
      {look.accessory === "sprig" && <g>
        <path d="M150 92 Q160 74 172 62" fill="none" stroke={LEAF} strokeWidth="2.5" strokeLinecap="round" />
        <ellipse cx="160" cy="78" rx="5" ry="10" transform="rotate(-50 160 78)" fill={LEAF} />
        <ellipse cx="170" cy="70" rx="5" ry="9" transform="rotate(40 170 70)" fill={LEAF} />
        <ellipse cx="174" cy="60" rx="4.5" ry="8" transform="rotate(-20 174 60)" fill="#86a26d" />
      </g>}
    </g>
  </svg>;
}
