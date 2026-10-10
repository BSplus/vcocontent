import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import type { MediaItem } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { downloadMedia, downloadOptionLabel } from "@/lib/media-download";
import { Button } from "@/components/ui/button";
import MainNavigation from "@/components/main-navigation";
import Footer from "@/components/footer";
import MediaRightsNotice from "@/components/media-rights-notice";

export default function MediaDetail() {
  const [, params] = useRoute("/media/:id");
  const id = Number(params?.id);
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: item, isLoading, isError } = useQuery<MediaItem>({
    queryKey: [`/api/media/${id}`],
    enabled: Number.isSafeInteger(id) && id > 0,
    retry: false,
  });
  useEffect(() => {
    document.title = item ? `${item.caption || "Esports media"} | VCO Media Database` : "VCO Media Database";
  }, [item]);

  async function download(quality: "high" | "low") {
    if (!item) return;
    try {
      await downloadMedia(item, quality);
    } catch (error) {
      toast({ title: "Download unavailable", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    }
  }

  return <div className="min-h-screen bg-background">
    <MainNavigation />
    <main className="container mx-auto px-4 py-8">
      {isLoading ? <p>Loading media…</p> : isError || !item ? <p>Media not found.</p> : <>
        <Link href={`/events/${item.eventId}`} className="text-primary underline">Back to event gallery</Link>
        <h1 className="mt-5 text-2xl font-bold">{item.caption || "Esports racing media"}</h1>
        <div className="mt-6 flex justify-center rounded-lg bg-black/40 p-3">
          {item.type === "video" && user && item.url
            ? <video controls preload="none" poster={item.thumbnail} src={item.url} className="max-h-[75vh] max-w-full" />
            : <img src={item.thumbnail} alt={item.caption || "Esports racing photo"} className="max-h-[75vh] max-w-full object-contain" />}
        </div>
        {item.type === "video" && !user && <p className="mt-3">Sign in to watch this video.</p>}
        {item.photographer && <p className="mt-4">Photographer: {item.photographer}</p>}
        <div className="mt-6 flex flex-wrap gap-3">
          {user
            ? <Button onClick={() => download("high")}>{downloadOptionLabel(item, "high")}</Button>
            : <Button asChild><Link href="/auth">{downloadOptionLabel(item, "high")} · Register or sign in</Link></Button>}
          {item.type === "image" && <Button variant="outline" onClick={() => download("low")}>{downloadOptionLabel(item, "low")}</Button>}
        </div>
        <div className="mt-4"><MediaRightsNotice /></div>
      </>}
    </main>
    <Footer />
  </div>;
}