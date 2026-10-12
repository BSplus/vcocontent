import { useRef, type TouchEvent } from "react";

/** Bind only to a photo surface, never a video or the actions/scrolling dialog. */
export function usePhotoSwipe(enabled: boolean, previous: () => void, next: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart(event: TouchEvent) {
      start.current = enabled && event.touches.length === 1 &&
        !(event.target as HTMLElement).closest("button, a, video, input")
        ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
    },
    onTouchMove(event: TouchEvent) {
      if (event.touches.length !== 1) { start.current = null; return; }
      if (start.current && Math.abs(event.touches[0].clientY - start.current.y) > 24 &&
        Math.abs(event.touches[0].clientY - start.current.y) > Math.abs(event.touches[0].clientX - start.current.x)) start.current = null;
    },
    onTouchEnd(event: TouchEvent) {
      const origin = start.current;
      start.current = null;
      if (!origin || !enabled || !event.changedTouches[0]) return;
      const dx = event.changedTouches[0].clientX - origin.x;
      const dy = event.changedTouches[0].clientY - origin.y;
      if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.6) (dx < 0 ? next : previous)();
    },
    onTouchCancel() { start.current = null; },
  };
}
