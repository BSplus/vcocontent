import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload, Plus, Trash2, FileText, Download } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";

export interface EventEntryRow {
  number: string;
  team: string;
  car: string;
  drivers: string;
  manufacturer?: string;
  racingClass?: string;
  discipline?: string;
  eventName?: string;
  session?: string;
  issues?: string[];
}

function normalizeRow(value: Partial<EventEntryRow> & { number?: unknown; drivers?: unknown; manufacturer?: unknown; racingClass?: unknown; discipline?: unknown; eventName?: unknown; session?: unknown }): EventEntryRow {
  return {
    number: value.number == null ? "" : String(value.number),
    team: value.team == null ? "" : String(value.team),
    car: value.car == null ? "" : String(value.car),
    drivers: Array.isArray(value.drivers)
      ? value.drivers.map(String).join(", ")
      : value.drivers == null ? "" : String(value.drivers),
    manufacturer: value.manufacturer == null ? "" : String(value.manufacturer),
    racingClass: value.racingClass == null ? "" : String(value.racingClass),
    discipline: value.discipline == null ? "" : String(value.discipline),
    eventName: value.eventName == null ? "" : String(value.eventName),
    session: value.session == null ? "" : String(value.session),
    issues: Array.isArray(value.issues) ? value.issues.map(String) : [],
  };
}

interface ReferenceDocument {
  id: number;
  title: string;
  kind: "entry" | "result";
  scope: "event" | "season";
  seasonYear: number;
  session: string | null;
  rows: EventEntryRow[];
  downloadUrl: string | null;
  inherited: boolean;
}

interface ReferencesResponse {
  documents: ReferenceDocument[];
  seriesId: number | null;
  seasonYear: number;
  canUseSeason: boolean;
}

export interface PendingEventReference {
  file: File;
  kind: "entry" | "result";
  scope: "event" | "season";
  seasonYear: number;
  session: string;
  rows?: EventEntryRow[];
}

async function responseError(response: Response, fallback: string) {
  try {
    const body = await response.json();
    return body.error || body.message || fallback;
  } catch {
    return fallback;
  }
}

interface EntryListEditorProps {
  eventId: number | null;
  seriesId?: number | null;
  seasonYear?: number;
  onDraftChange?: (draft: { rows: EventEntryRow[] | null; blocked: boolean }) => void;
  onReferenceSelection?: (reference: PendingEventReference) => void;
  refreshReferencesToken?: number;
}

export default function EntryListEditor({ eventId, seriesId, seasonYear, onDraftChange, onReferenceSelection, refreshReferencesToken = 0 }: EntryListEditorProps) {
  const queryClient=useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const referenceFileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<EventEntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [references, setReferences] = useState<ReferenceDocument[]>([]);
  const [referencesMeta, setReferencesMeta] = useState<Pick<ReferencesResponse, "seasonYear" | "canUseSeason">>({
    seasonYear: seasonYear ?? new Date().getFullYear(), canUseSeason: eventId === null && !!seriesId,
  });
  const [referenceSeasonYear, setReferenceSeasonYear] = useState(seasonYear ?? new Date().getFullYear());
  const [referenceKind, setReferenceKind] = useState<"entry" | "result">("entry");
  const [referenceScope, setReferenceScope] = useState<"event" | "season">("event");
  const [referenceSession, setReferenceSession] = useState("");
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [stagedReferenceName, setStagedReferenceName] = useState("");
  const [stagedReferenceFile, setStagedReferenceFile] = useState<File | null>(null);
  const [parsedReferenceFile, setParsedReferenceFile] = useState<File | null>(null);
  const [reimportTarget, setReimportTarget] = useState<ReferenceDocument | null>(null);
  const [referencesLoading, setReferencesLoading] = useState(false);
  const [expandedReferenceIds, setExpandedReferenceIds] = useState<Set<number>>(() => new Set());
  const [entryPreviewOpen, setEntryPreviewOpen] = useState(false);
  const [stagedEntryFileName, setStagedEntryFileName] = useState("");

  useEffect(() => {
    if (eventId === null) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setLoadFailed(false);
    setPreviewMode(false);
    setConfirmed(false);
    fetch(`/api/events/${eventId}/entries`, { credentials: "include" })
      .then(async response => {
        if (!response.ok) throw new Error(await responseError(response, "Could not load the entry list."));
        return response.json();
      })
      .then((data: unknown) => {
        if (!Array.isArray(data)) throw new Error("The server returned an invalid entry list.");
        if (!cancelled) {
          setRows(data.map(row => normalizeRow(row)));
          setLoadFailed(false);
        }
      })
      .catch((reason: Error) => {
        if (!cancelled) {
          setError(reason.message || "Could not load the entry list.");
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [eventId]);

  const loadReferences = async (id: number) => {
    setReferencesLoading(true);
    try {
      const response = await fetch(`/api/events/${id}/references`, { credentials: "include" });
      if (!response.ok) throw new Error(await responseError(response, "Could not load reference documents."));
      const data = await response.json() as ReferencesResponse;
      setReferences(Array.isArray(data.documents) ? data.documents : []);
      setReferencesMeta({ seasonYear: data.seasonYear, canUseSeason: data.canUseSeason });
      setReferenceSeasonYear(data.seasonYear);
      setReferenceError(null);
    } finally {
      setReferencesLoading(false);
    }
  };

  const importReference = async (id: number, file: File, replacing?: ReferenceDocument | null) => {
    setReferenceBusy(true);
    setReferenceError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("kind", replacing?.kind ?? referenceKind);
      body.append("scope", replacing?.scope ?? referenceScope);
      body.append("seasonYear", String(replacing?.seasonYear ?? (eventId !== null ? referenceSeasonYear : seasonYear ?? referenceSeasonYear)));
      body.append("session", replacing?.session ?? referenceSession);
      if (replacing) {
        body.append("replaceId", String(replacing.id));
        body.append("title", replacing.title);
      }
      const response = await fetch(`/api/events/${id}/references`, { method: "POST", credentials: "include", body });
      if (!response.ok) throw new Error(await responseError(response, "Could not import reference document."));
      await loadReferences(id);
      void queryClient.invalidateQueries({queryKey:["/api/creator/usage"]});
      toast({ title: replacing ? "Reference reimported" : "Reference imported", description: "The source document and parsed entries are now available." });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Could not import reference document.";
      setReferenceError(message);
      toast({ title: "Reference import failed", description: message, variant: "destructive" });
    } finally {
      setReferenceBusy(false);
    }
  };

  useEffect(() => {
    if (eventId !== null || !stagedReferenceFile) return;
    onReferenceSelection?.({
      file: stagedReferenceFile,
      kind: referenceKind,
      scope: referenceScope,
      seasonYear: seasonYear ?? referenceSeasonYear,
      session: referenceSession,
      rows:parsedReferenceFile===stagedReferenceFile && !previewing && !error && rows.length ? rows : undefined,
    });
  }, [eventId, stagedReferenceFile, parsedReferenceFile, rows, previewing, error, referenceKind, referenceScope, seasonYear, referenceSeasonYear, referenceSession, onReferenceSelection]);

  useEffect(() => {
    if (eventId === null) return;
    void loadReferences(eventId).catch(reason => setReferenceError(reason instanceof Error ? reason.message : "Could not load reference documents."));
  }, [eventId, refreshReferencesToken]);

  const saveReference = async (document: ReferenceDocument) => {
    if (eventId === null) return;
    setReferenceBusy(true);
    try {
      const response = await fetch(`/api/events/${eventId}/references/${document.id}`, {
        method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: document.rows, title: document.title, session: document.session }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Could not save reference corrections."));
      await loadReferences(eventId);
      toast({ title: "Reference updated" });
    } catch (reason) {
      setReferenceError(reason instanceof Error ? reason.message : "Could not save reference corrections.");
    } finally {
      setReferenceBusy(false);
    }
  };

  const removeReference = async (document: ReferenceDocument) => {
    if (eventId === null) return;
    const confirmation = document.scope === "season"
      ? `Delete “${document.title}” for Season ${document.seasonYear}? This removes the original season source and its imported entries from all matching events for this owner, series, and season.`
      : `Delete “${document.title}” from this event? This removes the original source document and its imported entries.`;
    if (!window.confirm(confirmation)) return;
    setReferenceBusy(true);
    try {
      const response = await fetch(`/api/events/${eventId}/references/${document.id}`, { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error(await responseError(response, "Could not remove reference document."));
      await loadReferences(eventId);
      void queryClient.invalidateQueries({queryKey:["/api/creator/usage"]});
    } catch (reason) {
      setReferenceError(reason instanceof Error ? reason.message : "Could not remove reference document.");
    } finally {
      setReferenceBusy(false);
    }
  };

  const saveReferenceSeason = async () => {
    if (eventId === null || !Number.isInteger(referenceSeasonYear) || referenceSeasonYear < 1900 || referenceSeasonYear > 2200) {
      setReferenceError("Enter a valid season year.");
      return;
    }
    setReferenceBusy(true);
    setReferenceError(null);
    try {
      const response = await fetch(`/api/events/${eventId}/reference-settings`, {
        method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seasonYear: referenceSeasonYear }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Could not update the event reference season."));
      await loadReferences(eventId);
      toast({ title: "Reference season updated", description: "Season-level entries have been refreshed." });
    } catch (reason) {
      setReferenceError(reason instanceof Error ? reason.message : "Could not update the event reference season.");
    } finally {
      setReferenceBusy(false);
    }
  };

  useEffect(() => {
    if (eventId !== null) return;
    onDraftChange?.({
      rows: !previewing && !error && rows.length
        ? rows.map(({ number, team, car, drivers, manufacturer, racingClass, discipline }) => ({ number, team, car, drivers, manufacturer, racingClass, discipline }))
        : null,
      blocked: previewing || !!error || (previewMode && !rows.length),
    });
  }, [eventId, rows, previewing, error, previewMode, onDraftChange]);

  const changeRow = (index: number, field: keyof Pick<EventEntryRow, "number" | "team" | "car" | "drivers" | "manufacturer" | "racingClass" | "discipline">, value: string) => {
    setRows(current => current.map((row, rowIndex) =>
      rowIndex === index ? { ...row, [field]: value } : row
    ));
    setConfirmed(false);
  };

  const previewFile = async (file?: File) => {
    if (!file) return;
    setStagedEntryFileName(file.name);
    setEntryPreviewOpen(false);
    const formData = new FormData();
    formData.append("file", file);
    setPreviewing(true);
    setError(null);
    setConfirmed(false);
    try {
      const response = await fetch(eventId === null ? "/api/events/entries/preview" : `/api/events/${eventId}/entries/preview`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!response.ok) throw new Error(await responseError(response, "Could not preview the entry list."));
      const result = await response.json();
      if (!Array.isArray(result.rows)) throw new Error("The server returned an invalid entry preview.");
      setRows(result.rows.map((row: unknown) => normalizeRow(row as Partial<EventEntryRow>)));
      setParsedReferenceFile(file);
      setIssues(Array.isArray(result.issues) ? result.issues.filter((issue: unknown): issue is string => typeof issue === "string") : []);
      setLoadFailed(false);
      setPreviewMode(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not preview the entry list.");
    } finally {
      setPreviewing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const saveRows = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/events/${eventId}/entries`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: rows.map(({ number, team, car, drivers, manufacturer, racingClass, discipline }) => ({ number, team, car, drivers, manufacturer, racingClass, discipline })),
        }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Could not save the entry list."));
      const result = await response.json().catch(() => null);
      if (result && Array.isArray(result.rows)) setRows(result.rows.map((row: unknown) => normalizeRow(row as Partial<EventEntryRow>)));
      setPreviewMode(false);
      setIssues([]);
      setConfirmed(false);
      toast({ title: "Entry list saved", description: "The event entry list has been replaced." });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the entry list.");
    } finally {
      setSaving(false);
    }
  };

  const stagedEntryPreview = eventId === null && previewMode && rows.length > 0;
  const entryRowEditors = rows.map((row, index) => (
    <div key={index} className="space-y-2 rounded-md border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {([
          ["number", "Number"],
          ["team", "Team"],
          ["car", "Car"],
          ["drivers", "Listed drivers"],
          ["manufacturer", "Manufacturer"],
          ["racingClass", "Racing class"],
          ["discipline", "Discipline"],
        ] as const).map(([field, label]) => (
          <div key={field} className="space-y-1">
            <Label htmlFor={`entry-${index}-${field}`}>{label}</Label>
            <Input id={`entry-${index}-${field}`} value={row[field]}
              onChange={event => changeRow(index, field, event.target.value)} disabled={saving} />
          </div>
        ))}
      </div>
      {!!row.issues?.length && (
        <ul className="list-disc pl-5 text-sm text-amber-700 dark:text-amber-400" aria-label={`Warnings for entry ${index + 1}`}>
          {row.issues.map((issue, issueIndex) => <li key={issueIndex}>{issue}</li>)}
        </ul>
      )}
      <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={saving}
        onClick={() => {
          setRows(current => current.filter((_, rowIndex) => rowIndex !== index));
          setConfirmed(false);
        }}>
        <Trash2 className="mr-2 h-4 w-4" /> Remove row
      </Button>
    </div>
  ));

  return (
    <section className="space-y-3 rounded-md border p-4" aria-labelledby="entry-list-heading">
      <div>
        <h3 id="entry-list-heading" className="font-semibold">Entry list</h3>
        <p className="text-sm text-muted-foreground">
          {eventId === null
            ? "Optional: add entry rows manually or preview a file. Any rows present are added when you create the event."
            : "Upload a list to preview it, make corrections, then explicitly confirm before replacing the saved list."}
        </p>
      </div>

      <div className="space-y-3 rounded-md bg-muted/30 p-3">
        <div>
          <h4 className="font-medium">Entry & result references</h4>
          <p className="text-sm text-muted-foreground">Import CSV, XLSX, PDF or a screenshot. Entries are parsed automatically; you can correct them below.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Select value={referenceKind} onValueChange={value => setReferenceKind(value as "entry" | "result")}>
            <SelectTrigger aria-label="Reference type"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="entry">Entry list</SelectItem><SelectItem value="result">Result list</SelectItem></SelectContent>
          </Select>
          <Select value={referenceScope} onValueChange={value => setReferenceScope(value as "event" | "season")}>
            <SelectTrigger aria-label="Reference scope"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="event">This event</SelectItem>
              {(referencesMeta.canUseSeason || (eventId === null && !!seriesId)) && <SelectItem value="season">Series season ({eventId === null ? seasonYear ?? referenceSeasonYear : referenceSeasonYear})</SelectItem>}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-40 flex-1 space-y-1">
            <Label htmlFor="reference-session">Session or race (optional)</Label>
            <Input id="reference-session" value={referenceSession} onChange={event => setReferenceSession(event.target.value)} placeholder="e.g. Race 1" />
          </div>
          <Input ref={referenceFileRef} type="file" className="hidden" accept=".csv,.xlsx,.xls,.pdf,.jpg,.jpeg,.png,.webp"
            aria-label="Choose an entry or result reference"
            onChange={event => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (eventId === null) {
                setStagedReferenceFile(file);
                setStagedReferenceName(file.name);
                onReferenceSelection?.({
                  file,
                  kind: referenceKind,
                  scope: referenceScope,
                  seasonYear: seasonYear ?? referenceSeasonYear,
                  session: referenceSession,
                });
                toast({ title: "Reference ready", description: "It will be imported automatically after the event is created." });
              } else void importReference(eventId, file, reimportTarget);
              setReimportTarget(null);
              event.target.value = "";
            }} />
          <Button type="button" variant="outline" disabled={referenceBusy} onClick={() => {
            setReimportTarget(null);
            referenceFileRef.current?.click();
          }}>
            {referenceBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            {eventId === null ? "Choose source file" : "Import reference"}
          </Button>
        </div>
        {eventId !== null && referencesMeta.canUseSeason && (
          <div className="flex flex-wrap items-end gap-2 rounded border p-3">
            <div className="min-w-36 flex-1 space-y-1">
              <Label htmlFor="reference-season-year">Reference season</Label>
          <Input id="reference-season-year" type="number" min={1990} max={2100} value={referenceSeasonYear}
                onChange={event => setReferenceSeasonYear(Number(event.target.value))} />
            </div>
            <Button type="button" size="sm" variant="outline" disabled={referenceBusy || referenceSeasonYear === referencesMeta.seasonYear}
              onClick={() => void saveReferenceSeason()}>Update season</Button>
          </div>
        )}
        {eventId === null && stagedReferenceName && <p role="status" className="text-sm text-muted-foreground">Selected: {stagedReferenceName} · it will be imported automatically after event creation.</p>}
        {referenceError && <p role="alert" className="text-sm text-destructive">{referenceError}</p>}
        {eventId !== null && referencesLoading && <p role="status" className="text-sm text-muted-foreground">Loading reference documents…</p>}
        {eventId !== null && !referencesLoading && !referenceError && references.length === 0 &&
          <p className="text-sm text-muted-foreground">No reference documents yet. Choose a file to import an entry or result list.</p>}
        {eventId !== null && referenceError && <Button type="button" size="sm" variant="outline" onClick={() =>
          void loadReferences(eventId).catch(reason => setReferenceError(reason instanceof Error ? reason.message : "Could not load reference documents."))}>Retry loading</Button>}
        {eventId !== null && references.map(document => (
          <article key={document.id} className="space-y-2 rounded border p-3">
            {document.scope === "season" && (
              <p className="rounded bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                Season source: edits and saved corrections apply to all matching events for this owner, series, and Season {document.seasonYear}.
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2"><FileText className="h-4 w-4" />
                <Input aria-label="Document title" value={document.title} onChange={event => setReferences(current => current.map(item => item.id === document.id ? { ...item, title: event.target.value } : item))} className="max-w-sm" />
                <span className="text-xs text-muted-foreground">{document.kind === "entry" ? "Entry list" : "Result list"} · {document.scope === "season" ? `Season ${document.seasonYear}` : "Event"}{document.inherited ? " · inherited" : ""} · {document.rows.length} imported {document.rows.length === 1 ? "entry" : "entries"}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {document.downloadUrl && <Button type="button" size="sm" variant="ghost" asChild><a href={document.downloadUrl} target="_blank" rel="noreferrer"><Download className="mr-1 h-4 w-4" />Source</a></Button>}
                <Button type="button" size="sm" variant="outline" disabled={referenceBusy} onClick={() => {
                  setReimportTarget(document);
                  referenceFileRef.current?.click();
                }}><Upload className="mr-1 h-4 w-4" />Reimport</Button>
                <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={referenceBusy} onClick={() => void removeReference(document)}><Trash2 className="h-4 w-4" /><span className="sr-only">Remove reference</span></Button>
              </div>
            </div>
            <details className="rounded border px-3" onToggle={event => setExpandedReferenceIds(current => {
              const next = new Set(current);
              if (event.currentTarget.open) next.add(document.id);
              else next.delete(document.id);
              return next;
            })}>
              <summary className="cursor-pointer py-3 text-sm font-medium">Edit {document.rows.length} imported entries</summary>
              {expandedReferenceIds.has(document.id) && <div className="space-y-3 pb-3">
                <div className="space-y-1">
                  <Label htmlFor={`ref-session-${document.id}`}>Session</Label>
                  <Input id={`ref-session-${document.id}`} value={document.session || ""} placeholder="Optional" onChange={event => setReferences(current => current.map(item => item.id === document.id ? { ...item, session: event.target.value || null } : item))} />
                </div>
                {document.rows.map((row, index) => <div key={index} className="relative grid gap-2 rounded border p-2 sm:grid-cols-2">
                  {([
                    ["number", "Number"], ["team", "Team"], ["car", "Vehicle"], ["drivers", "Listed drivers"],
                    ["manufacturer", "Manufacturer"], ["racingClass", "Racing class"], ["discipline", "Discipline"],
                    ["eventName", "Event name"], ["session", "Row session"],
                  ] as const).map(([field, label]) => <div key={field} className="space-y-1">
                    <Label htmlFor={`ref-${document.id}-${index}-${field}`}>{label}</Label>
                    <Input id={`ref-${document.id}-${index}-${field}`} value={row[field] || ""} onChange={event => setReferences(current => current.map(item => item.id === document.id
                      ? { ...item, rows: item.rows.map((entry, rowIndex) => rowIndex === index ? { ...entry, [field]: event.target.value } : entry) } : item))} />
                  </div>)}
                  <Button type="button" size="sm" variant="ghost" className="text-destructive sm:col-span-2" onClick={() => setReferences(current => current.map(item => item.id === document.id
                    ? { ...item, rows: item.rows.filter((_, rowIndex) => rowIndex !== index) } : item))}>Remove entry</Button>
                </div>)}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setReferences(current => current.map(item => item.id === document.id
                    ? { ...item, rows: [...item.rows, { number: "", team: "", car: "", drivers: "", manufacturer: "", racingClass: "", discipline: "", eventName: "", session: "" }] } : item))}>
                    <Plus className="mr-1 h-4 w-4" />Add reference entry
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={referenceBusy} onClick={() => void saveReference(document)}>Save corrections</Button>
                </div>
              </div>}
            </details>
          </article>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.pdf,.jpg,.jpeg,.png,.webp"
          aria-label="Choose an entry list file"
          className="hidden"
          disabled={loading || previewing || saving}
          onChange={event => void previewFile(event.target.files?.[0])}
        />
        {previewing && <span role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Parsing preview…</span>}
        {previewMode && eventId !== null && <span className="text-sm font-medium">Unsaved preview</span>}
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {issues.length > 0 && <ul role="status" className="list-disc pl-5 text-sm text-amber-600">
        {issues.map((issue, index) => <li key={index}>{issue}</li>)}
      </ul>}
      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">Loading entry list…</p>
      ) : (
        <>
          {stagedEntryPreview && (
            <div className="space-y-2 rounded-md border border-border/70 p-3">
              <p className="text-sm text-muted-foreground">
                {stagedEntryFileName || "Selected file"} · {rows.length} imported {rows.length === 1 ? "row" : "rows"} · included when the event is created
              </p>
              <details open={entryPreviewOpen} onToggle={event => setEntryPreviewOpen(event.currentTarget.open)}
                className="rounded border px-3">
                <summary className="cursor-pointer py-2 text-sm font-medium">Edit {rows.length} imported entries</summary>
                {entryPreviewOpen && <div className="space-y-3 pb-3">{entryRowEditors}</div>}
              </details>
            </div>
          )}
          {!stagedEntryPreview && rows.length === 0 && <p className="text-sm text-muted-foreground">No entries yet. Add a row or upload a file to preview.</p>}
          {!stagedEntryPreview && <div className="space-y-3">{entryRowEditors}</div>}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={saving || previewing}
              onClick={() => {
                setRows(current => [...current, { number: "", team: "", car: "", drivers: "", manufacturer: "", racingClass: "", discipline: "", issues: [] }]);
                setConfirmed(false);
                if (stagedEntryPreview) setEntryPreviewOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" /> Add row
            </Button>
            <Button type="button" variant="outline" disabled={saving || previewing || loading} onClick={() => fileRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" /> Choose file
            </Button>
          </div>
          {eventId !== null && <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={confirmed} disabled={saving || loading || loadFailed}
              onChange={event => setConfirmed(event.target.checked)} className="mt-1" />
            <span>I reviewed these rows and confirm replacing the event’s saved entry list.</span>
          </label>}
          {eventId === null ? (
            <>
              {(rows.length > 0 || previewMode || error) && (
                <Button type="button" variant="ghost" disabled={previewing} onClick={() => {
                  setRows([]);
                  setIssues([]);
                  setError(null);
                  setPreviewMode(false);
                  setConfirmed(false);
                  setEntryPreviewOpen(false);
                  setStagedEntryFileName("");
                }}>Discard entry list</Button>
              )}
            </>
          ) : (
            <Button type="button" disabled={!confirmed || saving || loading || previewing || loadFailed} onClick={() => void saveRows()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm and save entry list
            </Button>
          )}
        </>
      )}
    </section>
  );
}