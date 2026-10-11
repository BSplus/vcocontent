import { useEffect, useRef, useState } from "react";

type Props = { src?: string | null; poster?: string; signedIn: boolean; className?: string };

/** Shared, user-initiated player. Source changes own a fresh playback lifecycle. */
export default function VideoPreview(props: Props) {
  const src = props.src?.trim();
  return <Player key={`${props.signedIn}:${src}`} {...props} src={src} />;
}

function Player({ src, poster, signedIn, className = "" }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const diagnostic = useRef<AbortController>();
  useEffect(() => {
    const player = video.current;
    return () => {
      diagnostic.current?.abort();
      if (player) { player.pause(); player.removeAttribute("src"); player.load(); }
    };
  }, [retry]);

  async function failed() {
    const code = video.current?.error?.code;
    let message = code === 3
      ? "This video could not be decoded. The file may be damaged or use an unsupported codec."
      : code === 4
        ? "This video format or codec is not supported by your browser, or the file is damaged."
        : "The video could not be loaded. Check your connection and try again.";
    diagnostic.current?.abort();
    const controller = new AbortController();
    diagnostic.current = controller;
    setLoading(false);
    setError(message);
    // Only diagnose our authenticated routes; never probe external URLs.
    if (src && /^\/api\/media\/(?:files\/|legacy\/)/.test(src)) {
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch(src, { method: "HEAD", credentials: "same-origin",
          signal: controller.signal, cache: "no-store" });
        if (response.status === 401) message = "Your session has expired. Sign in again to play this video.";
        else if (response.status === 403) message = "You do not have permission to play this video.";
        else if (response.status === 404) message = "This video source is missing or is no longer available to you.";
        else if (!response.ok) message = "The video source is temporarily unavailable. Please try again.";
        if (!controller.signal.aborted) setError(message);
      } catch { /* Keep the browser's safe, visible diagnostic. */ }
      finally { clearTimeout(timeout); }
    }
  }
  const notice = !signedIn ? "Sign in to play this video. The poster is still available."
    : !src ? "This video has no playback source. Please contact the gallery owner." : error;
  return <div className={`relative flex h-full w-full flex-col items-center justify-center bg-black/20 ${className}`}>
    {signedIn && src
      ? <video key={retry} ref={video} src={src} poster={poster} controls playsInline preload="metadata"
          aria-label="Video preview" className="min-h-0 w-full flex-1 object-contain"
          onLoadStart={() => { setLoading(true); setError(""); }}
          onLoadedData={() => setLoading(false)} onCanPlay={() => setLoading(false)}
          onWaiting={() => setLoading(true)} onPlaying={() => setLoading(false)}
          onError={() => void failed()} />
      : poster && <img src={poster} alt="Video poster" className="min-h-0 max-h-full w-full object-contain" />}
    {loading && !notice && <p role="status" className="pointer-events-none absolute top-2 rounded bg-black/85 px-3 py-2 text-sm text-white">Loading video…</p>}
    {notice && <div role={error ? "alert" : "status"} className="w-full shrink-0 bg-black/85 px-3 py-2 text-sm text-white">
      <p>{notice}</p>
      {error && <button type="button" className="mt-2 min-h-11 underline" onClick={() => {
        diagnostic.current?.abort(); setError(""); setRetry(value => value + 1);
      }}>Try again</button>}
    </div>}
  </div>;
}
