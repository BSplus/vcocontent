import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Image as ImageIcon, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { PageMetadata } from "@shared/pagination";
import PageStatus from "@/components/page-status";

interface MatchingPhoto {
  id: number;
  caption: string | null;
  captionSource: string | null;
  identificationManual: boolean;
  status: string | null;
  error: string | null;
  matchStatus: string | null;
}

interface MatchingResponse extends PageMetadata {
  enabled: boolean;
  platform: string | null;
  nextCursor?: number | null;
  photos: MatchingPhoto[];
  positionReset?: boolean;
}

interface PhotoMatchingControlsProps {
  eventId: number;
}

async function readError(response: Response, fallback: string) {
  try {
    const body = await response.json();
    return body.error || body.message || fallback;
  } catch {
    return fallback;
  }
}

function isActive(status: string | null | undefined) {
  return status === "queued" || status === "running";
}

function isPreservedCaption(source: string | null | undefined) {
  return source === "preserved";
}

export default function PhotoMatchingControls({ eventId }: PhotoMatchingControlsProps) {
  const queryClient = useQueryClient();
  const [data, setData] = useState<MatchingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [platformDraft, setPlatformDraft] = useState("");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [replacePreserved, setReplacePreserved] = useState<Set<number>>(() => new Set());
  const [confirmed, setConfirmed] = useState(false);
  const [localResults, setLocalResults] = useState<Record<number, { status: string; error?: string }>>({});
  const wasActive = useRef(false);
  const [before, setBefore] = useState<number | undefined>();
  const [previousPages, setPreviousPages] = useState<Array<number | undefined>>([]);
  const previousCaptions = useRef<string | null>(null);
  const platformInitialized = useRef(false);
  const request = useRef<AbortController | null>(null);
  const previousPhotoIds = useRef<string | null>(null);
  const [positionNotice, setPositionNotice] = useState<string | null>(null);

  const refresh = useCallback(async (quiet = false) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(`/api/events/${eventId}/photo-matching${before ? `?before=${before}&page=${previousPages.length + 1}` : ""}`, { credentials: "include", signal: controller.signal });
      if (!response.ok) throw new Error(await readError(response, "Could not load photo matching."));
      const result = await response.json() as MatchingResponse;
      if (controller.signal.aborted) return;
      if (!Array.isArray(result.photos)) throw new Error("The server returned an invalid photo matching response.");
      const photos = result.photos.slice(0, 500);
      const ids = JSON.stringify(photos.map(photo => [photo.id, photo.identificationManual]));
      if (result.positionReset || (previousPhotoIds.current !== null && previousPhotoIds.current !== ids)) {
        setSelected(new Set());
        setReplacePreserved(new Set());
        setConfirmed(false);
        setLocalResults({});
      }
      previousPhotoIds.current = ids;
      if (result.positionReset) {
        setBefore(undefined);
        setPreviousPages([]);
        setPositionNotice("The photo list changed. Returned to the first page and cleared the selection.");
      }
      if (!platformInitialized.current) {
        setPlatformDraft(result.platform || "");
        platformInitialized.current = true;
      }
      const activeNow = photos.some(photo => isActive(photo.status));
      const captionSnapshot=JSON.stringify(photos.map(photo=>[photo.id,photo.caption,photo.captionSource]));
      if ((wasActive.current && !activeNow) || (previousCaptions.current!==null && previousCaptions.current!==captionSnapshot)) {
        void queryClient.invalidateQueries({ queryKey: ["/api/creator/media"] });
        void queryClient.invalidateQueries({ predicate: query =>
          String(query.queryKey[0]).startsWith(`/api/events/${eventId}/media`) ||
          (String(query.queryKey[0]).startsWith("/api/media/") && !String(query.queryKey[0]).endsWith("/analysis")) ||
          String(query.queryKey[0]) === `/api/events/${eventId}` });
        // Keep open editor drafts intact; gallery/editor queries will receive persisted captions on refetch.
      }
      wasActive.current = activeNow;
      previousCaptions.current=captionSnapshot;
      setData({ ...result, photos });
      setError(null);
    } catch (reason) {
      if (controller.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : "Could not load photo matching.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
  }, [eventId, before, previousPages.length, queryClient]);

  useEffect(()=>{setBefore(undefined);setPreviousPages([]);previousCaptions.current=null;previousPhotoIds.current=null;setPositionNotice(null);},[eventId]);

  useEffect(() => {
    setData(null);
    setSelected(new Set());
    setReplacePreserved(new Set());
    setConfirmed(false);
    setLocalResults({});
    wasActive.current = false;
    platformInitialized.current = false;
    void refresh();
    return () => request.current?.abort();
  }, [eventId, refresh]);

  useEffect(() => {
    // Polling must not repeatedly abort slow initial/page requests. Explicit
    // refreshes and resource changes still cancel obsolete requests.
    const timer = window.setInterval(() => {
      if (!request.current) void refresh(true);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  const active=data?.photos.some(photo=>isActive(photo.status)) ?? false;

  const saveSettings = async (enabled: boolean, platform: string | null) => {
    if (!data) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/events/${eventId}/photo-matching`, {
        method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, platform }),
      });
      if (!response.ok) throw new Error(await readError(response, "Could not save photo matching settings."));
      const result = await response.json().catch(() => null) as Partial<MatchingResponse> | null;
      setData(current => current ? { ...current, enabled, platform, ...(result?.photos ? { photos: result.photos.slice(0, 500) } : {}) } : current);
      setPlatformDraft(platform || "");
      await refresh(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save photo matching settings.");
      void refresh(true);
    } finally {
      setSaving(false);
    }
  };

  const processSelected = async () => {
    const chosen = Array.from(selected).slice(0, 50).filter(id =>
      data?.photos.some(photo => photo.id === id && !photo.identificationManual));
    if (!data || chosen.length === 0 || !confirmed) return;
    const replacements = chosen.filter(id => replacePreserved.has(id) &&
      data.photos.some(photo => photo.id === id && isPreservedCaption(photo.captionSource)));
    setProcessing(true);
    setError(null);
    try {
      const response = await fetch(`/api/events/${eventId}/photo-matching/process`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaIds: chosen, confirmed: true, replacePreservedIds: replacements }),
      });
      if (!response.ok) throw new Error(await readError(response, "Could not process selected photos."));
      const result = await response.json() as { results?: Array<{ id: number; status: string; error?: string }> };
      const failures = result.results?.filter(item => item.error || item.status === "failed").length ?? 0;
      setLocalResults(current => ({
        ...current,
        ...(result.results || []).reduce<Record<number, { status: string; error?: string }>>((next, item) => {
          next[item.id] = { status: item.status, ...(item.error ? { error: item.error } : {}) };
          return next;
        }, {}),
      }));
      // A successful request can reuse already-completed matches without ever entering a queued state.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/creator/media"] }),
        queryClient.invalidateQueries({ predicate: query =>
          String(query.queryKey[0]).startsWith(`/api/events/${eventId}/media`) ||
          (String(query.queryKey[0]).startsWith("/api/media/") && !String(query.queryKey[0]).endsWith("/analysis")) ||
          String(query.queryKey[0]) === `/api/events/${eventId}` }),
      ]);
      setSelected(new Set());
      setReplacePreserved(new Set());
      setConfirmed(false);
      await refresh(true);
      if (failures) setError(`${failures} selected ${failures === 1 ? "photo needs" : "photos need"} attention. Review the status details below.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not process selected photos.");
    } finally {
      setProcessing(false);
    }
  };

  const toggleSelected = (id: number, checked: boolean) => {
    setSelected(current => {
      const next = new Set(current);
      if (checked) {
        if (next.size < 50) next.add(id);
      } else next.delete(id);
      return next;
    });
    setConfirmed(false);
  };

  return (
    <section className="space-y-4 rounded-md border border-border bg-card p-4" aria-labelledby="photo-matching-heading">
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-primary/10 p-2 text-primary"><ImageIcon className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <h4 id="photo-matching-heading" className="font-semibold">Photo matching</h4>
          <p className="mt-1 text-sm text-muted-foreground">
            Match event photos against the saved entry list. Enabling this applies to future uploads only; it never processes existing photos.
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="Refresh photo matching status"
          disabled={loading || saving || processing} onClick={() => void refresh()}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {loading && !data ? (
        <div className="space-y-2" role="status" aria-label="Loading photo matching">
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-10 animate-pulse rounded bg-muted" />
          <div className="h-16 animate-pulse rounded bg-muted" />
        </div>
      ) : data ? (
        <>
          <div className="grid gap-3 rounded-md bg-muted/30 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="space-y-1">
              <Label htmlFor={`photo-match-platform-${eventId}`}>Sim-racing platform (optional)</Label>
              <div className="flex max-w-lg flex-wrap gap-2">
                <Input id={`photo-match-platform-${eventId}`} value={platformDraft} maxLength={120}
                  placeholder="e.g. iRacing" aria-label="Sim-racing platform (optional)"
                  onChange={event => setPlatformDraft(event.target.value)} disabled={saving} />
                <Button type="button" variant="outline" disabled={saving || platformDraft.trim() === (data.platform || "")}
                  onClick={() => void saveSettings(data.enabled, platformDraft.trim() || null)}>
                  Save platform
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-3 sm:justify-end">
              <div className="text-right">
                <Label htmlFor={`photo-match-enabled-${eventId}`} className="block">Automatic matching</Label>
                <p className="text-xs text-muted-foreground">{data.enabled ? "Enabled for new uploads" : "Off"}</p>
              </div>
              <Switch id={`photo-match-enabled-${eventId}`} checked={data.enabled} disabled={saving}
                onCheckedChange={enabled => {
                  if (!enabled && data.enabled && !window.confirm("Turning off photo matching stops in-progress automatic matching writes and prevents automatic matching for new uploads. Existing results will remain unchanged.")) return;
                  void saveSettings(enabled, data.platform);
                }} />
            </div>
          </div>
          {saving && <p className="text-xs text-muted-foreground" role="status">Saving settings…</p>}

          <div className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h5 className="font-medium">Existing photos <span className="font-normal text-muted-foreground">({data.photos.length}{data.photos.length === 500 ? " max shown" : ""})</span></h5>
                <p className="text-xs text-muted-foreground">Choose photos to process. Each request is limited to 50 photos.</p>
              </div>
              {active && <span className="inline-flex items-center gap-2 text-xs text-muted-foreground" role="status"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Matching in progress</span>}
            </div>
            {data.photos.length === 0 ? (
              <div className="rounded-md border border-dashed p-5 text-center">
                <p className="text-sm font-medium">No photos to match</p>
                <p className="mt-1 text-xs text-muted-foreground">Photos from this event will appear here after upload.</p>
              </div>
            ) : (
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {data.photos.map(photo => {
                  const protectedIdentification = photo.identificationManual;
                  const preserved = isPreservedCaption(photo.captionSource);
                  const selectedForReplacement = replacePreserved.has(photo.id);
                  return (
                    <article key={photo.id} className="space-y-2 rounded-md border p-3">
                      <div className="flex items-start gap-3">
                        <Checkbox id={`match-photo-${eventId}-${photo.id}`} checked={selected.has(photo.id)}
                            disabled={loading || !!error || protectedIdentification || processing || selected.size >= 50 && !selected.has(photo.id)}
                          onCheckedChange={value => toggleSelected(photo.id, value === true)}
                          aria-label={`Select photo ${photo.id}`} className="mt-1" />
                        <div className="min-w-0 flex-1">
                          <Label htmlFor={`match-photo-${eventId}-${photo.id}`} className="cursor-pointer font-medium">
                            Photo {photo.id}
                          </Label>
                          <p className="mt-1 break-words text-sm text-muted-foreground">{photo.caption || "No caption"}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                            {photo.status && <span className="rounded bg-muted px-2 py-1">{photo.status.replaceAll("_", " ")}</span>}
                            {photo.matchStatus === "no_unique_match" && <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-800 dark:text-amber-300">No unique match</span>}
                            {protectedIdentification && <span className="rounded border px-2 py-1">Manual identification · skipped</span>}
                            {(isActive(photo.status)) && <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Processing</span>}
                            {photo.status === "completed" && <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3" /> Complete</span>}
                          </div>
                          {(localResults[photo.id]?.error || photo.error) && <p role="alert" className="mt-2 text-xs text-destructive">{localResults[photo.id]?.error || photo.error}</p>}
                          {localResults[photo.id]?.status === "failed" && !localResults[photo.id]?.error && !photo.error &&
                            <p role="alert" className="mt-2 text-xs text-destructive">Photo matching failed. Retry this photo later.</p>}
                          {preserved && (
                            <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs text-muted-foreground">
                              <Checkbox checked={selectedForReplacement} disabled={processing || !selected.has(photo.id)}
                                onCheckedChange={value => setReplacePreserved(current => {
                                  const next = new Set(current);
                                  if (value === true) next.add(photo.id); else next.delete(photo.id);
                                  return next;
                                })} />
                              <span>Replace this explicitly preserved historical caption with the generated caption, including context-only text if there is no unique match. Leaving this unchecked keeps it unchanged.</span>
                            </label>
                          )}
                          {photo.captionSource === "manual" && <p className="mt-2 text-xs text-muted-foreground">Manual caption is protected from automatic replacement; processing will not overwrite it.</p>}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            {positionNotice && <p role="status" className="text-sm text-muted-foreground">{positionNotice}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <PageStatus page={data.page} totalPages={!loading && !error ? data.totalPages : undefined} />
              <Button type="button" variant="outline" disabled={loading || !!error || data.page === 1 || !previousPages.length || processing} onClick={()=>{
                setPositionNotice(null);
                setBefore(previousPages[previousPages.length-1]);setPreviousPages(previousPages.slice(0,-1));
              }}>Newer photos</Button>
              <Button type="button" variant="outline" disabled={loading || !!error || !data.hasMore || !data.nextCursor || processing} onClick={()=>{
                setPositionNotice(null);
                setPreviousPages([...previousPages,before]);setBefore(data.nextCursor!);
              }}>Older photos</Button>
              <span className="text-xs text-muted-foreground">Up to 500 photos per page. Changing pages clears the selection.</span>
            </div>
            {selected.size > 0 && (
              <div className="space-y-3 rounded-md border border-primary/25 bg-primary/5 p-3">
                <p className="text-sm font-medium">{selected.size} of 50 photos selected</p>
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <Checkbox checked={confirmed} onCheckedChange={value => setConfirmed(value === true)} disabled={processing} />
                  <span className="inline-flex items-start gap-2">
                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    I explicitly confirm that the selected photos will be sent for AI matching. Manual identifications are skipped; protected captions will not be replaced unless individually selected above.
                  </span>
                </label>
                <Button type="button" disabled={!confirmed || processing || selected.size === 0} onClick={() => void processSelected()}>
                  {processing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  {processing ? "Submitting photos…" : `Process ${selected.size} selected ${selected.size === 1 ? "photo" : "photos"}`}
                </Button>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <p className="flex items-center gap-2 text-sm text-destructive" role="alert"><AlertTriangle className="h-4 w-4" />{error || "Photo matching could not be loaded."}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>Retry</Button>
        </div>
      )}
      {error && data && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
