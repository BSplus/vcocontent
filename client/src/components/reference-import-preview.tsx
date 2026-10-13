import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EventEntryRow } from "./entry-list-editor";

export default function ReferenceImportPreview({ name, rows, issues, confirmed, busy, onRows,
  onConfirm, onSave, onCancel }: {
  name: string; rows: EventEntryRow[]; issues: string[]; confirmed: boolean; busy: boolean;
  onRows: (rows: EventEntryRow[]) => void; onConfirm: (value: boolean) => void;
  onSave: () => void; onCancel: () => void;
}) {
  return <section aria-label="Reference import preview" className="space-y-3 rounded border p-3">
    <p className="text-sm">{name} · {rows.length} vehicle entries · unsaved preview</p>
    <p className="text-sm text-muted-foreground">Review the registered lineup. Saved lists, sources and captions remain unchanged until you confirm and save.</p>
    {!!issues.length && <ul role="status" className="list-disc pl-5 text-sm text-amber-600">
      {issues.map((issue, index) => <li key={index}>{issue}</li>)}
    </ul>}
    <details className="rounded border px-3">
      <summary className="cursor-pointer py-2 text-sm font-medium">Edit {rows.length} preview entries</summary>
      <div className="space-y-3 pb-3">{rows.map((row, index) => <div key={index} className="space-y-2 rounded border p-2">
        <div className="grid gap-2 sm:grid-cols-2">{([
          ["number", "Number"], ["team", "Team"], ["car", "Car"], ["drivers", "Listed drivers"],
          ["manufacturer", "Manufacturer"], ["racingClass", "Racing class"], ["discipline", "Discipline"],
          ["eventName", "Event name"], ["session", "Row session"],
        ] as const).map(([field, label]) => <div key={field}>
          <Label htmlFor={`reference-preview-${index}-${field}`}>{label}</Label>
          <Input id={`reference-preview-${index}-${field}`} value={row[field] || ""} disabled={busy}
            onChange={event => onRows(rows.map((entry, i) => i === index ? { ...entry, [field]: event.target.value } : entry))} />
        </div>)}</div>
        {!!row.issues?.length && <ul aria-label={`Reference warnings for entry ${index + 1}`} className="list-disc pl-5 text-sm text-amber-600">
          {row.issues.map((issue, i) => <li key={i}>{issue}</li>)}
        </ul>}
        <Button type="button" variant="ghost" disabled={busy} onClick={() => onRows(rows.filter((_, i) => i !== index))}>Remove entry</Button>
      </div>)}</div>
    </details>
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" checked={confirmed} disabled={busy || !rows.length} onChange={event => onConfirm(event.target.checked)} />
      <span>I reviewed these rows and confirm saving this reference source and its corrected entries.</span>
    </label>
    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={busy || !confirmed || !rows.length} onClick={onSave}>Confirm and save reference</Button>
      <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Discard reference preview</Button>
    </div>
  </section>;
}
