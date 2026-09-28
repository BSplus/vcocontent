import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload, Plus, Trash2 } from "lucide-react";

export interface EventEntryRow {
  number: string;
  team: string;
  car: string;
  drivers: string;
  issues?: string[];
}

function normalizeRow(value: Partial<EventEntryRow> & { number?: unknown; drivers?: unknown }): EventEntryRow {
  return {
    number: value.number == null ? "" : String(value.number),
    team: value.team == null ? "" : String(value.team),
    car: value.car == null ? "" : String(value.car),
    drivers: Array.isArray(value.drivers)
      ? value.drivers.map(String).join(", ")
      : value.drivers == null ? "" : String(value.drivers),
    issues: Array.isArray(value.issues) ? value.issues.map(String) : [],
  };
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
  onDraftChange?: (draft: { rows: EventEntryRow[] | null; blocked: boolean }) => void;
}

export default function EntryListEditor({ eventId, onDraftChange }: EntryListEditorProps) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<EventEntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);

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

  useEffect(() => {
    if (eventId !== null) return;
    onDraftChange?.({
      rows: confirmed && !previewing && !error && rows.length
        ? rows.map(({ number, team, car, drivers }) => ({ number, team, car, drivers }))
        : null,
      blocked: previewing || !!error || (rows.length > 0 && !confirmed) || (previewMode && !rows.length),
    });
  }, [eventId, rows, confirmed, previewing, error, previewMode, onDraftChange]);

  const changeRow = (index: number, field: keyof Pick<EventEntryRow, "number" | "team" | "car" | "drivers">, value: string) => {
    setRows(current => current.map((row, rowIndex) =>
      rowIndex === index ? { ...row, [field]: value } : row
    ));
    setConfirmed(false);
  };

  const previewFile = async (file?: File) => {
    if (!file) return;
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
          rows: rows.map(({ number, team, car, drivers }) => ({ number, team, car, drivers })),
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

  return (
    <section className="space-y-3 rounded-md border p-4" aria-labelledby="entry-list-heading">
      <div>
        <h3 id="entry-list-heading" className="font-semibold">Entry list</h3>
        <p className="text-sm text-muted-foreground">
          {eventId === null
            ? "Optional: upload a list now, review the rows, then confirm them before creating the event."
            : "Upload a list to preview it, make corrections, then explicitly confirm before replacing the saved list."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          ref={fileRef}
          type="file"
          accept=".csv,.pdf,.jpg,.jpeg,.png,.webp"
          aria-label="Choose an entry list file"
          className="hidden"
          disabled={loading || previewing || saving}
          onChange={event => void previewFile(event.target.files?.[0])}
        />
        {previewing && <span role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Parsing preview…</span>}
        {previewMode && <span className="text-sm font-medium">Unsaved preview</span>}
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {issues.length > 0 && <ul role="status" className="list-disc pl-5 text-sm text-amber-600">
        {issues.map((issue, index) => <li key={index}>{issue}</li>)}
      </ul>}
      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">Loading entry list…</p>
      ) : (
        <>
          {rows.length === 0 && <p className="text-sm text-muted-foreground">No entries yet. Add a row or upload a file to preview.</p>}
          <div className="space-y-3">
            {rows.map((row, index) => (
              <div key={index} className="space-y-2 rounded-md border p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  {([
                    ["number", "Number"],
                    ["team", "Team"],
                    ["car", "Car"],
                    ["drivers", "Drivers"],
                  ] as const).map(([field, label]) => (
                    <div key={field} className="space-y-1">
                      <Label htmlFor={`entry-${index}-${field}`}>{label}</Label>
                      <Input
                        id={`entry-${index}-${field}`}
                        value={row[field]}
                        onChange={event => changeRow(index, field, event.target.value)}
                        disabled={saving}
                      />
                    </div>
                  ))}
                </div>
                {!!row.issues?.length && (
                  <ul className="list-disc pl-5 text-sm text-amber-700 dark:text-amber-400" aria-label={`Warnings for entry ${index + 1}`}>
                    {row.issues.map((issue, issueIndex) => <li key={issueIndex}>{issue}</li>)}
                  </ul>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  disabled={saving}
                  onClick={() => {
                    setRows(current => current.filter((_, rowIndex) => rowIndex !== index));
                    setConfirmed(false);
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Remove row
                </Button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={saving || previewing}
              onClick={() => {
                setRows(current => [...current, { number: "", team: "", car: "", drivers: "", issues: [] }]);
                setConfirmed(false);
              }}
            >
              <Plus className="mr-2 h-4 w-4" /> Add row
            </Button>
            <Button type="button" variant="outline" disabled={saving || previewing || loading} onClick={() => fileRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" /> Choose file
            </Button>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={saving || loading || loadFailed}
              onChange={event => setConfirmed(event.target.checked)}
              className="mt-1"
            />
            <span>{eventId === null
              ? "I reviewed these rows and confirm adding them when the event is created."
              : "I reviewed these rows and confirm replacing the event’s saved entry list."}</span>
          </label>
          {eventId === null ? (
            <>
              {confirmed && rows.length > 0 && !error && <p role="status" className="text-sm text-green-700 dark:text-green-400">Entry list ready to save with the event.</p>}
              {(rows.length > 0 || previewMode || error) && (
                <Button type="button" variant="ghost" disabled={previewing} onClick={() => {
                  setRows([]);
                  setIssues([]);
                  setError(null);
                  setPreviewMode(false);
                  setConfirmed(false);
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