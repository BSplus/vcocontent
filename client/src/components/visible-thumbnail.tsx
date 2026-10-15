import { useLayoutEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { watchThumbnail } from "@/lib/thumbnail-lookahead";

/** Bounded look-ahead in both axes; source changes are evaluated independently. */
export default function VisibleThumbnail(props: ImgHTMLAttributes<HTMLImageElement>) {
  const ref = useRef<HTMLImageElement>(null);
  const [active, setActive] = useState<{ source: string | undefined; high: boolean }>();
  useLayoutEffect(() => {
    const image = ref.current;
    if (!image || !props.src) return;
    return watchThumbnail(image, high => setActive({ source: props.src, high }));
  }, [props.src]);
  return <img {...props} ref={ref} src={active?.source === props.src ? props.src : undefined}
    loading="eager" {...{ fetchpriority: active?.high ? "high" : "auto" }} decoding="async" />;
}
