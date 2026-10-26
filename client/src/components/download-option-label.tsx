import { useQuery } from "@tanstack/react-query";
import type { MediaItem } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { downloadOptionLabel, type DownloadQuality } from "@/lib/media-download";

/** Dropdown content mounts only when opened: no per-grid background encoding. */
export default function DownloadOptionLabel({ item, quality }: { item: MediaItem; quality: DownloadQuality }) {
  const { user } = useAuth();
  const allowed = quality === "low" || !!user;
  const info = useQuery<{ bytes: number | null }>({
    queryKey: ["download-size", item.id, item.url, item.contentVersion, item.safetyVersion, quality, user?.id ?? null],
    enabled: allowed,
    staleTime: 60_000,
    gcTime: 120_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const response = await fetch(`/api/media/${item.id}/download-info?quality=${quality}`, { credentials: "include" });
      if (!response.ok) throw new Error(response.status === 401 ? "Sign in to see size" : "Size unavailable");
      const value = await response.json();
      if (value.bytes !== null && (!Number.isSafeInteger(value.bytes) || value.bytes < 1)) throw new Error("Size unavailable");
      return value;
    },
  });
  const status = !allowed ? "sign in to see size" : info.isError
    ? (info.error instanceof Error ? info.error.message : "Size unavailable")
    : info.isPending ? "calculating size…" : undefined;
  return <span title={typeof info.data?.bytes === "number" ? undefined : status}>
    {downloadOptionLabel(item, quality, info.data?.bytes, status)}
  </span>;
}
