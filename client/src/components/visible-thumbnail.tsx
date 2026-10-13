import { useLayoutEffect, useRef, useState, type ImgHTMLAttributes } from "react";

/** Native lazy loading prefetches distant/horizontally clipped cards. Use actual visibility. */
export default function VisibleThumbnail({ anticipate = false, ...props }: ImgHTMLAttributes<HTMLImageElement> & { anticipate?: boolean }) {
  const ref = useRef<HTMLImageElement>(null);
  const [visible, setVisible] = useState(false);
  useLayoutEffect(() => {
    const image = ref.current;
    if (!image || visible) return;
    if (!("IntersectionObserver" in window)) { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      // A queued entry can describe the viewport before a fast scroll.
      // Recheck now, or old rows compete with the images the user actually sees.
      const rect = image.getBoundingClientRect();
      if (entries.some(entry => entry.isIntersecting) && rect.top < window.innerHeight &&
          rect.bottom > 0 && rect.left < window.innerWidth && rect.right > 0) {
        setVisible(true); observer.disconnect();
      }
    });
    observer.observe(image);
    return () => observer.disconnect();
  }, [visible]);
  // At most the first poster of a media row may use the browser's bounded
  // native look-ahead. Other posters wait for actual viewport intersection.
  return <img {...props} ref={ref} src={visible || anticipate ? props.src : undefined}
    loading={visible ? "eager" : "lazy"} {...{ fetchpriority: visible ? "high" : "auto" }} decoding="async" />;
}
