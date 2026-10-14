export interface CanvasViewport {
  scrollLeft: number;
  scrollTop: number;
  clientWidth: number;
  clientHeight: number;
  scrollWidth: number;
  scrollHeight: number;
}

function bounded(viewport: CanvasViewport, left: number, top: number) {
  return {
    left: Math.max(0, Math.min(left, viewport.scrollWidth - viewport.clientWidth)),
    top: Math.max(0, Math.min(top, viewport.scrollHeight - viewport.clientHeight)),
  };
}

export function canvasCenterPosition(
  viewport: CanvasViewport,
  node: { left: number; top: number; width: number; height: number },
) {
  return bounded(
    viewport,
    node.left + (node.width - viewport.clientWidth) / 2,
    node.top + (node.height - viewport.clientHeight) / 2,
  );
}

export function canvasKeyboardPosition(viewport: CanvasViewport, key: string) {
  const { scrollLeft: left, scrollTop: top } = viewport;
  const page = Math.max(48, viewport.clientHeight * 0.8);
  switch (key) {
    case "ArrowLeft": return bounded(viewport, left - 48, top);
    case "ArrowRight": return bounded(viewport, left + 48, top);
    case "ArrowUp": return bounded(viewport, left, top - 48);
    case "ArrowDown": return bounded(viewport, left, top + 48);
    case "PageUp": return bounded(viewport, left, top - page);
    case "PageDown": return bounded(viewport, left, top + page);
    case "Home": return bounded(viewport, left, 0);
    case "End": return bounded(viewport, left, viewport.scrollHeight);
    default: return null;
  }
}
