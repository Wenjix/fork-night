/** The supervised pilot supports a moment from one image to a short sequence. */
export const MAX_PILOT_PANELS = 3;
export const MAX_PANEL_CAPTION = 500;

export function pilotCreditCost(panelCount: number): number {
  if (
    !Number.isInteger(panelCount) ||
    panelCount < 1 ||
    panelCount > MAX_PILOT_PANELS
  )
    throw new Error("Choose one to three panels.");
  return Math.ceil(panelCount / 2);
}

export function validPilotCaptions(
  value: unknown,
  allowDraft = false,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= (allowDraft ? 0 : 1) &&
    value.length <= MAX_PILOT_PANELS &&
    value.every(
      (caption) =>
        typeof caption === "string" &&
        caption.length <= MAX_PANEL_CAPTION &&
        (allowDraft || caption.trim().length > 0),
    )
  );
}

/** A provider-free preview. Keep the author's words, splitting only at whitespace.
 * Never silently truncate a long idea or add story events to fill panels. */
export function panelsFromThought(thought: string): string[] {
  const text = thought.trim();
  if (!text)
    throw new Error("Bring an idea first — a note or a few words is enough.");
  const panels: string[] = [];
  let remaining = text;
  while (remaining.length > MAX_PANEL_CAPTION) {
    const prefix = remaining.slice(0, MAX_PANEL_CAPTION + 1);
    let split = -1;
    for (let i = prefix.length - 1; i > 0; i--) {
      if (/\s/.test(prefix[i])) {
        split = i;
        break;
      }
    }
    if (split < 1)
      throw new Error(
        "Break that long passage into shorter words or sentences before previewing.",
      );
    panels.push(remaining.slice(0, split).trimEnd());
    remaining = remaining.slice(split).trimStart();
    if (panels.length >= MAX_PILOT_PANELS)
      throw new Error(
        "This idea needs a little trimming to fit three panels. Your full thought is still here.",
      );
  }
  panels.push(remaining);
  return panels;
}
