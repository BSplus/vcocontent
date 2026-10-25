import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";

/** Source changes remount retry state; unmounting cancels all future requests. */
export default function PreviewImage(props: ImgHTMLAttributes<HTMLImageElement>) {
  return <RetryingImage key={props.src} {...props} />;
}

function RetryingImage({ src, onError, onLoad, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  let source = src;
  if (attempt && src) {
    const url = new URL(src, window.location.href);
    url.searchParams.set("_previewRetry", String(attempt));
    source = url.href;
  }
  return <>
    <img {...props} src={source} data-preview-attempt={attempt}
      style={{ ...props.style, ...(failed ? { visibility: "hidden" } : {}) }}
      onLoad={event => { clearTimeout(timer.current); setFailed(false); onLoad?.(event); }}
      onError={event => {
        onError?.(event);
        setFailed(true);
        clearTimeout(timer.current);
        // Native image errors do not expose HTTP status. Retry at most three
        // times, with backoff/jitter; every request still passes authorization.
        if (src && !/^(data|blob):/.test(src) && attempt < 3)
          timer.current = setTimeout(() => { setFailed(false); setAttempt(value => value + 1); },
            5_000 * 2 ** attempt + Math.floor(Math.random() * 1_000));
      }} />
    {failed && <span className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground"
      role="status">{attempt < 3 && src && !/^(data|blob):/.test(src)
        ? "Retrying preview…" : "Preview unavailable"}</span>}
  </>;
}
