import { Children, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import "./mobile-gallery-row.css";

/** Native touch scrolling; only the small, already loaded collection is rendered. */
export default function MobileGalleryRow({ children, label, className }: {
  children: ReactNode; label: string; className: string;
}) {
  const cards = Children.toArray(children);
  const row = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(0);
  const [atEnd, setAtEnd] = useState(false);
  const gesture = useRef({ x: 0, y: 0, moved: false, active: false, suppressUntil: 0 });
  useEffect(() => {
    const element = row.current;
    if (!element) return;
    const update = () => {
      const offsets = Array.from(element.children, child => (child as HTMLElement).offsetLeft - element.offsetLeft);
      let nearest = 0;
      offsets.forEach((offset, index) => {
        if (Math.abs(offset - element.scrollLeft) < Math.abs(offsets[nearest] - element.scrollLeft)) nearest = index;
      });
      const end = element.scrollLeft + element.clientWidth >= element.scrollWidth - 2;
      setPosition(end ? Math.max(0, cards.length - 1) : nearest);
      setAtEnd(end);
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => { element.removeEventListener("scroll", update); observer.disconnect(); };
  }, [cards.length]);
  const move = (direction: number) => {
    const element = row.current;
    if (!element) return;
    const child = element.children[Math.max(0, Math.min(cards.length - 1, position + direction))] as HTMLElement;
    element.scrollTo({ left: child.offsetLeft - element.offsetLeft,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };
  return <div className="min-w-0" role="region" aria-label={label}>
    <div ref={row} className={`mobile-gallery-row ${className}`} data-single={cards.length <= 1}
      onPointerDownCapture={event => {
        gesture.current = { x: event.clientX, y: event.clientY, moved: false, active: true, suppressUntil: 0 };
      }}
      onPointerMoveCapture={event => {
        const state = gesture.current;
        if (state.active && Math.hypot(event.clientX - state.x, event.clientY - state.y) > 10) {
          state.moved = true;
          state.suppressUntil = performance.now() + 700;
        }
      }}
      onPointerUpCapture={() => { gesture.current.active = false; }}
      onPointerCancelCapture={() => {
        gesture.current.active = false;
        gesture.current.suppressUntil = performance.now() + 700;
      }}
      onClickCapture={event => {
        if (event.detail !== 0 && gesture.current.suppressUntil > performance.now()) {
          event.preventDefault(); event.stopPropagation();
        }
      }}>
      {cards.map((card, index) => <div key={(card as { key?: string }).key ?? index} className="mobile-gallery-card">{card}</div>)}
    </div>
    {cards.length > 1 && <div className="mt-3 flex items-center justify-end gap-3 md:hidden">
      <span className="mr-auto text-xs tabular-nums text-muted-foreground" aria-live="polite">{position + 1} / {cards.length}</span>
      <Button variant="outline" size="icon" className="h-11 w-11" aria-label={`Previous ${label}`} disabled={position === 0} onClick={() => move(-1)}><ChevronLeft className="h-4 w-4" /></Button>
      <Button variant="outline" size="icon" className="h-11 w-11" aria-label={`Next ${label}`} disabled={atEnd} onClick={() => move(1)}><ChevronRight className="h-4 w-4" /></Button>
    </div>}
  </div>;
}
