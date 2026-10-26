import { Button } from "@/components/ui/button";
import { uploadBytesLabel, type CreatorUsage } from "@/lib/creator-upload-preflight";

export default function CreatorUploadSummary({ usage, failed, busy, onRetry, selected, eligible, quotaBlocked, invalid }: {
  usage?: CreatorUsage; failed: boolean; busy: boolean; onRetry: () => void;
  selected: number; eligible: number; quotaBlocked: number; invalid: number;
}) {
  return <section aria-label="Creator upload limits" className="space-y-2 rounded border border-border p-3 text-sm">
    <p className="font-semibold">Your Creator allowance</p>
    {usage && !failed ? <>
      <p>{usage.unknown ? "Remaining storage is not confirmed" : `${uploadBytesLabel(Math.max(0, usage.limits.bytes - usage.bytes))} storage remaining`} · {Math.max(0, usage.limits.photos - usage.photos).toLocaleString("en-US")} photos remaining.</p>
      <p>Limits: {uploadBytesLabel(usage.limits.bytes)} total · {usage.limits.photos.toLocaleString("en-US")} photos · {usage.limits.galleries} galleries · {uploadBytesLabel(usage.limits.imageBytes)} per photo. No videos.</p>
      <p className="text-muted-foreground">Files, previews, reserved uploads and pending deletions count. This pre-check reserves 102,400 extra bytes per new photo for its preview; the server checks final usage.</p>
      {!!usage.unknown && <p role="alert">{usage.pendingCleanup ? "Storage cleanup is pending; recheck shortly." : "Some file sizes are unknown. Ask an administrator to check storage before adding files."}</p>}
    </> : <p role="status">{failed ? "Capacity could not be loaded. New uploads wait until the check succeeds." : "Checking your remaining capacity…"}</p>}
    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onRetry}>Recheck capacity</Button>
    {!!selected && <p aria-live="polite">{selected} selected · {eligible} eligible · {quotaBlocked} waiting for capacity · {invalid} unsupported or over file/batch limits. Completed files stay saved.</p>}
  </section>;
}
