"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import { canvasCenterPosition, canvasKeyboardPosition } from "../lib/canvas-navigation";

export function useCanvasNavigation(initialKey: string, selectedId: string) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const selected = useRef(selectedId);
  selected.current = selectedId;
  const helpId = useId();

  const centerOn = useCallback((id: string) => {
    const viewport = viewportRef.current;
    if (!viewport?.clientWidth || !viewport.clientHeight) return false;
    const node = Array.from(viewport.querySelectorAll<HTMLElement>("[data-canvas-node]"))
      .find(element => element.dataset.canvasNode === id);
    if (!node) return false;
    const frame = viewport.getBoundingClientRect(), box = node.getBoundingClientRect();
    viewport.scrollTo({
      ...canvasCenterPosition(viewport, {
        left: box.left - frame.left - viewport.clientLeft + viewport.scrollLeft,
        top: box.top - frame.top - viewport.clientTop + viewport.scrollTop,
        width: box.width,
        height: box.height,
      }),
      behavior: "instant",
    });
    return true;
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let centered = false;
    const observer = new ResizeObserver(() => revealInitial());
    function revealInitial() {
      if (!centered && centerOn(selected.current)) {
        centered = true;
        observer.disconnect();
      }
    }
    observer.observe(viewport);
    const frame = requestAnimationFrame(revealInitial);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [initialKey, centerOn]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const viewport = element;
    let drag: { id: number; x: number; y: number; left: number; top: number; active: boolean } | null = null;
    let suppressClick = false;

    function finish() {
      const previous = drag;
      drag = null;
      delete viewport.dataset.panning;
      if (previous && viewport.hasPointerCapture(previous.id)) viewport.releasePointerCapture(previous.id);
    }
    function down(event: PointerEvent) {
      suppressClick = false;
      if (event.pointerType !== "mouse" || !event.isPrimary || event.button !== 0 ||
        event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (!(target instanceof Element) || target.closest("a,input,textarea,select,[contenteditable],[data-canvas-no-pan]") ||
        target.closest("button") && !target.closest("[data-canvas-node]")) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop, active: false };
    }
    function move(event: PointerEvent) {
      if (!drag || event.pointerId !== drag.id) return;
      if (!(event.buttons & 1)) { finish(); return; }
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.active) {
        if (Math.hypot(dx, dy) < 5) return;
        drag.active = true;
        suppressClick = true;
        viewport.dataset.panning = "true";
        viewport.setPointerCapture(event.pointerId);
        viewport.focus({ preventScroll: true });
      }
      event.preventDefault();
      viewport.scrollTo({ left: drag.left - dx, top: drag.top - dy, behavior: "instant" });
    }
    function end(event: PointerEvent) {
      if (drag?.id === event.pointerId) finish();
    }
    function click(event: MouseEvent) {
      if (!suppressClick || event.detail === 0) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    }
    function preventImageDrag(event: DragEvent) {
      if (drag) event.preventDefault();
    }
    function keydown(event: KeyboardEvent) {
      if (event.target !== viewport || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const position = canvasKeyboardPosition(viewport, event.key);
      if (!position) return;
      event.preventDefault();
      viewport.scrollTo({ ...position, behavior: "instant" });
    }
    viewport.addEventListener("pointerdown", down);
    viewport.addEventListener("lostpointercapture", end);
    viewport.addEventListener("click", click, true);
    viewport.addEventListener("dragstart", preventImageDrag);
    viewport.addEventListener("keydown", keydown);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", finish);
    return () => {
      finish();
      viewport.removeEventListener("pointerdown", down);
      viewport.removeEventListener("lostpointercapture", end);
      viewport.removeEventListener("click", click, true);
      viewport.removeEventListener("dragstart", preventImageDrag);
      viewport.removeEventListener("keydown", keydown);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", finish);
    };
  }, [initialKey]);

  return { viewportRef, helpId, centerOn };
}
