import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, Loader2, RefreshCw, Search, Tag } from "lucide-react";
import type { MediaItem } from "@shared/schema";
import VideoPreview from "@/components/video-preview";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Identification = {
  number?: string | null;
  team?: string | null;
  drivers?: string | null;
  vehicle?: string | null;
  manufacturer?: string | null;
  racingClass?: string | null;
  discipline?: string | null;
  source?: string | null;
};

type NumberOption = {
  id: string;
  number: string;
  identification: Identification;
  contexts: string[];
  conflict: boolean;
  caption?: string;
};

type NumberOptions = {
  snapshot: string;
  replaceCaptionRequired: boolean;
  identification: Identification[];
  caption: string | null;
  session: string | null;
  options: NumberOption[];
  context: string;
};

interface AssignNumberActionProps {
  mediaItem: MediaItem;
  disabled?: boolean;
  disabledReason?: string;
  onSaved?: (item: MediaItem) => void;
}

function candidateSearchText(option: NumberOption) {
  const entry = option.identification;
  return [
    option.number, entry.team, entry.vehicle, entry.manufacturer,
    entry.racingClass, entry.discipline, entry.drivers, ...option.contexts,
  ].filter(Boolean).join(" ").toLocaleLowerCase();
}

export default function AssignNumberAction({
  mediaItem, disabled = false, disabledReason, onSaved,
}: AssignNumberActionProps) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NumberOptions | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [replaceIndex, setReplaceIndex] = useState<number | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [replaceCaption, setReplaceCaption] = useState(false);
  const [loading, setLoading] = useState(false);
  const [availabilityLoading, setAvailabilityLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [noReferences, setNoReferences] = useState(false);
  const [error, setError] = useState("");
  const [availabilityError, setAvailabilityError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [stale, setStale] = useState(false);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const requestSequence = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);

  const loadOptions = async (target: number | undefined) => {
    const requestNumber = ++requestSequence.current;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    setError("");
    setAvailabilityError("");
    setStale(false);
    setSaveError("");
    if (target === undefined) {
      setAvailabilityLoading(true);
      setNoReferences(false);
    }
    setReplaceIndex(target);
    setSelectedId("");
    setData(null);
    setReplaceCaption(false);
    try {
      const query = target === undefined ? "" : `?replaceIndex=${target}`;
      const response = await fetch(`/api/media/${mediaItem.id}/number-options${query}`, {
        credentials: "include",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      const result = await response.json().catch(() => ({}));
      if (requestNumber !== requestSequence.current) return;
      if (!response.ok) throw new Error(result.error || "Number references could not be loaded.");
      if (!result || typeof result.snapshot !== "string" || !Array.isArray(result.options) ||
        !Array.isArray(result.identification) || typeof result.replaceCaptionRequired !== "boolean" ||
        result.options.some((option: NumberOption) => !option || typeof option.id !== "string" ||
          !option.identification || !Array.isArray(option.contexts) || typeof option.caption !== "string")) {
        throw new Error("Number references returned an invalid response. Please retry.");
      }
      setData(result as NumberOptions);
      if (target === undefined) setNoReferences(Array.isArray(result.options) && result.options.length === 0);
    } catch (cause) {
      if (requestNumber !== requestSequence.current || controller.signal.aborted) return;
      const message = cause instanceof Error ? cause.message : "Number references could not be loaded.";
      setError(message);
      setAvailabilityError(message);
    } finally {
      if (requestNumber === requestSequence.current) {
        setLoading(false);
        if (target === undefined) setAvailabilityLoading(false);
      }
    }
  };

  useEffect(() => {
    setOpen(false);
    setData(null);
    setSelectedId("");
    setReplaceIndex(undefined);
    setSearch("");
    setSaveError("");
    setError("");
    setAvailabilityError("");
    setAvailabilityLoading(true);
    setNoReferences(false);
    setLoading(false);
    setSaving(false);
    setStale(false);
    setReplaceCaption(false);
    void loadOptions(undefined);
    return () => {
      requestSequence.current += 1;
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  // Availability is checked as soon as this action is rendered, using the saved server-side session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaItem.id]);

  const selected = data?.options.find(option => option.id === selectedId);
  const filteredOptions = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return (data?.options || []).filter(option => !needle || candidateSearchText(option).includes(needle) ||
      (/^\d{1,4}$/.test(needle) && Number(needle) === Number(option.number)));
  }, [data, search]);
  const needsCaptionReplacement = !!data?.replaceCaptionRequired;
  const targetLabel = replaceIndex === undefined
    ? "Add a vehicle"
    : `Replace vehicle ${replaceIndex + 1}${data?.identification[replaceIndex]?.number ? ` · #${data.identification[replaceIndex].number}` : ""}`;

  const save = async () => {
    if (!data || !selected || (needsCaptionReplacement && !replaceCaption)) return;
    setSaving(true);
    setSaveError("");
    setStale(false);
    try {
      const response = await fetch(`/api/media/${mediaItem.id}/assign-number`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          snapshot: data.snapshot,
          selectionId: selected.id,
          ...(replaceIndex === undefined ? {} : { replaceIndex }),
          replaceCaption,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409) {
          setStale(true);
          throw new Error(result.error || "These references changed. Reload and choose a number again.");
        }
        throw new Error(result.error || "The number could not be assigned.");
      }
      const saved = result as MediaItem;
      await queryClient.cancelQueries({ queryKey: [`/api/media/${mediaItem.id}/analysis`], exact: true });
      queryClient.setQueryData([`/api/media/${mediaItem.id}/analysis`], (old: any) =>
        old ? { ...old, caption: saved.caption, captionSource: "manual",
          identification: (saved as any).identification, identificationManual: true } : old);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/creator/media"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/media"] }),
        queryClient.invalidateQueries({ predicate: query => {
          const key = String(query.queryKey[0]);
          return key.startsWith(`/api/events/${mediaItem.eventId}/media`) ||
            key.includes("/search") || key.startsWith("/api/search");
        } }),
      ]);
      onSaved?.(saved);
      setOpen(false);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "The number could not be assigned.");
    } finally {
      setSaving(false);
    }
  };

  const changeTarget = (value: string) => {
    const target = value === "add" ? undefined : Number(value);
    setReplaceIndex(target);
    void loadOptions(target);
  };

  const effectiveDisabledReason = disabledReason ||
    (availabilityLoading ? "Checking saved number references…" :
      noReferences ? "No numbered references are available for this media." : undefined);

  return <>
    <Button type="button" variant="outline" disabled={disabled || noReferences || availabilityLoading} title={(disabled || noReferences || availabilityLoading) ? effectiveDisabledReason : undefined}
      aria-label={`Assign number to ${mediaItem.caption || `media ${mediaItem.id}`}`} onClick={() => {
        setSelectedId("");
        setSaveError("");
        setStale(false);
        setOpen(true);
        void loadOptions(undefined);
      }}>
      <Tag className="mr-2 h-4 w-4" />Assign number
    </Button>
    {(disabled || noReferences || availabilityLoading) && effectiveDisabledReason &&
      <p className="mt-1 text-xs text-muted-foreground" role="note">{effectiveDisabledReason}</p>}
    {availabilityError && <div role="alert" className="mt-2 space-y-2 text-xs text-destructive">
      <p>{availabilityError}</p>
      <Button type="button" size="sm" variant="outline" disabled={loading || availabilityLoading}
        onClick={() => void loadOptions(undefined)}><RefreshCw className="mr-2 h-3 w-3" />Retry reference check</Button>
    </div>}
    {noReferences && !availabilityError && <div className="mt-2 space-y-2 text-xs text-muted-foreground" role="note">
      <p>No applicable numbered references are saved for this event or session. Upload or save an entry/reference list with race numbers; automatic recognition is not required.</p>
      <Button type="button" size="sm" variant="outline" disabled={loading || availabilityLoading}
        onClick={() => void loadOptions(undefined)}><RefreshCw className="mr-2 h-3 w-3" />Refresh references</Button>
    </div>}
    <Dialog open={open} onOpenChange={next => { if (!saving) setOpen(next); }}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] overflow-y-auto p-4 sm:max-w-2xl sm:p-6"
        onEscapeKeyDown={event => { if (saving) event.preventDefault(); }}
        onInteractOutside={event => { if (saving) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>Assign a race number</DialogTitle>
          <DialogDescription>Choose an explicit entry from this media’s saved recognition references.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="relative aspect-video overflow-hidden rounded border border-border bg-muted">
              {mediaItem.type === "video"
                ? <VideoPreview src={mediaItem.url} poster={mediaItem.thumbnail} signedIn={!!user} />
                : <img src={mediaItem.url} alt={mediaItem.caption || "Media preview"} className="h-full w-full object-contain" />}
            </div>
            <div className="min-w-0 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Current caption</p>
              <p className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-sm">{data?.caption || mediaItem.caption || "No caption saved."}</p>
              <label className="block space-y-1 text-sm font-medium" htmlFor={`number-target-${mediaItem.id}`}>
                <span>Assignment</span>
                <span className="relative block">
                  <select id={`number-target-${mediaItem.id}`} value={replaceIndex === undefined ? "add" : String(replaceIndex)}
                    disabled={loading || saving || !data?.identification.length}
                    onChange={event => changeTarget(event.target.value)}
                    className="h-11 w-full appearance-none rounded-md border border-input bg-background px-3 pr-9 text-foreground">
                    <option value="add">Add a vehicle</option>
                    {(data?.identification || []).map((entry, index) => <option key={index} value={index}>
                      Replace vehicle {index + 1}{entry.number ? ` · #${entry.number}` : ""}
                    </option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                </span>
              </label>
              <p className="text-xs text-muted-foreground">{data?.context || "Reference context unavailable."}</p>
            </div>
          </div>

          {loading ? <div role="status" className="space-y-3 py-4">
            <div className="h-4 w-40 animate-pulse rounded bg-muted" /><div className="h-16 animate-pulse rounded bg-muted" />
            <p className="sr-only">Loading number references</p>
          </div> : error ? <div role="alert" className="space-y-3 rounded border border-destructive/40 bg-destructive/5 p-4">
            <p className="text-sm">{error}</p>
            <Button type="button" variant="outline" onClick={() => void loadOptions(replaceIndex)}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button>
          </div> : data && data.options.length === 0 ? <div className="rounded border border-dashed border-border p-5 text-sm text-muted-foreground">
            No applicable numbered references are saved for this event or session. Upload or save an entry/reference list with race numbers; automatic recognition is not required.
          </div> : data && <>
            <label className="relative block">
              <span className="sr-only">Search number, team, car, manufacturer, class, registered lineup, or context</span>
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input type="search" value={search} onChange={event => setSearch(event.target.value)} className="pl-9" disabled={saving}
                placeholder="Search number, team, car, class, lineup…" />
            </label>
            <div role="radiogroup" aria-label="Available number entries" className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {filteredOptions.map((option, index) => {
                const entry = option.identification;
                const active = selectedId === option.id;
                return <button key={option.id} type="button" role="radio" aria-checked={active}
                  tabIndex={active || (index === 0 && !filteredOptions.some(entry => entry.id === selectedId)) ? 0 : -1}
                  onKeyDown={event => {
                    if (saving) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedId(option.id);
                      return;
                    }
                    const offset = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 :
                      event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0;
                    if (!offset && event.key !== "Home" && event.key !== "End") return;
                    event.preventDefault();
                    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? filteredOptions.length - 1 :
                      (index + offset + filteredOptions.length) % filteredOptions.length;
                    setSelectedId(filteredOptions[nextIndex].id);
                    const radios = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
                    radios?.[nextIndex]?.focus();
                  }}
                  disabled={saving}
                  onClick={() => { setSelectedId(option.id); setReplaceCaption(false); }}
                  className={`w-full rounded border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}>
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-x-2 font-semibold">
                        <span className="text-lg">#{option.number}</span>{entry.team && <span>{entry.team}</span>}
                      </span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {[entry.vehicle, entry.manufacturer, entry.racingClass].filter(Boolean).join(" · ") || "Vehicle details not listed"}
                      </span>
                      {entry.drivers && <span className="mt-1 block text-xs text-muted-foreground">Registered lineup: {entry.drivers}</span>}
                      {!!option.contexts.length && <span className="mt-1 block text-xs text-muted-foreground">{option.contexts.join(" · ")}</span>}
                    </span>
                    {active && <Check className="mt-1 h-5 w-5 shrink-0 text-primary" />}
                  </span>
                  {option.conflict && <span className="mt-2 flex items-start gap-2 rounded bg-amber-500/10 p-2 text-xs text-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    This number has conflicting reference details. Confirm the team and registered lineup before assigning it.
                  </span>}
                </button>;
              })}
              {!filteredOptions.length && <p className="py-4 text-center text-sm text-muted-foreground">No entries match this search.</p>}
            </div>
            {selected && <section aria-label="Caption preview" className="space-y-2 rounded border border-primary/30 bg-primary/[0.04] p-3">
              <h3 className="text-sm font-semibold">Caption after assignment · {targetLabel}</h3>
              <p className="whitespace-pre-wrap break-words text-sm">{selected.caption ?? "The updated caption will be provided when available."}</p>
            </section>}
            {needsCaptionReplacement && <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded border border-amber-500/35 bg-amber-500/5 p-3 text-sm">
              <Checkbox checked={replaceCaption} onCheckedChange={value => setReplaceCaption(value === true)} disabled={saving} />
              <span><span className="font-medium">Replace the existing caption with the merged caption</span>
                <span className="mt-1 block text-xs text-muted-foreground">Required to keep the saved caption consistent with this number assignment.</span></span>
            </label>}
          </>}
          {saveError && <div role="alert" className="space-y-2 rounded border border-destructive/40 p-3 text-sm text-destructive">
            <p>{saveError}</p>
            {stale && <Button type="button" variant="outline" disabled={loading || saving}
              onClick={() => void loadOptions(replaceIndex)}><RefreshCw className="mr-2 h-4 w-4" />Reload references and choose again</Button>}
          </div>}
          <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" disabled={!selected || loading || !!error || stale || saving || (needsCaptionReplacement && !replaceCaption)}
              onClick={() => void save()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {saving ? "Saving…" : "Save assignment"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
