/** One scheduler for all thumbnails: no native lazy-loading of distant rows.
 * Geometry is checked at dispatch time, including horizontal scroll clipping. */
const waiting = new Map<HTMLImageElement, (high: boolean) => void>();
let frame = 0;
let prioritySlots = 2;
const verticalLead = 200;
const horizontalLead = 96;

function flush() {
  for (const [image, activate] of Array.from(waiting)) {
    const rect = image.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.top >= innerHeight + verticalLead ||
        rect.bottom <= -verticalLead || rect.left >= innerWidth + horizontalLead ||
        rect.right <= -horizontalLead) continue;
    let clipped = false;
    // Respect every clipping ancestor, not only the viewport. The modest
    // horizontal lead reaches the next card, not the whole swipe collection.
    for (let parent = image.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
        const bounds = parent.getBoundingClientRect();
        if (rect.left >= bounds.right + horizontalLead || rect.right <= bounds.left - horizontalLead) {
          clipped = true; break;
        }
      }
    }
    if (clipped) continue;
    const high = prioritySlots > 0 && rect.top < innerHeight && rect.bottom > 0 &&
      rect.left < innerWidth && rect.right > 0;
    if (high) prioritySlots--;
    waiting.delete(image);
    activate(high);
  }
}
function schedule() {
  if (!frame) frame = requestAnimationFrame(() => {
    frame = 0;
    prioritySlots = 2;
    flush();
  });
}

export function watchThumbnail(image: HTMLImageElement, activate: (high: boolean) => void) {
  if (!waiting.size) {
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
  }
  const resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
  resize?.observe(image);
  // Positional shifts from asynchronously completed rows above this one need
  // a new geometry check even if this image's own dimensions did not change.
  const intersection = typeof IntersectionObserver === "undefined" ? undefined :
    new IntersectionObserver(schedule, { rootMargin: `${verticalLead}px 0px` });
  intersection?.observe(image);
  waiting.set(image, high => {
    resize?.disconnect();
    intersection?.disconnect();
    activate(high);
  });
  // Layout effects run after all DOM mutations: relevant first images can
  // start now, without another render-frame or observer delivery delay.
  flush();
  schedule();
  return () => {
    resize?.disconnect();
    intersection?.disconnect();
    waiting.delete(image);
    if (!waiting.size) {
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }
  };
}
