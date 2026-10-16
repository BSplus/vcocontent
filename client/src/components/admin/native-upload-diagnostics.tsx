import { useQuery } from "@tanstack/react-query";
import type { NativeUploadDiagnostics } from "@shared/native-upload-diagnostics";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, Database, RefreshCw } from "lucide-react";

const diagnosticsKey = ["/api/admin/native-upload-diagnostics"];

const countLabels: Array<{ key: keyof NativeUploadDiagnostics["counts"]; label: string; detail: string }> = [
  { key: "sessions", label: "Sampled sessions", detail: "Uncleaned native JPEG sessions in this bounded sample" },
  { key: "receiving", label: "Receiving", detail: "Sessions still receiving upload parts" },
  { key: "finalizing", label: "Finalizing", detail: "Sessions being assembled or verified" },
  { key: "completedAwaitingCleanup", label: "Completed, awaiting cleanup", detail: "Completed sessions whose temporary data remains" },
  { key: "held", label: "Held", detail: "Sessions held from normal processing" },
  { key: "retryScheduled", label: "Retry scheduled", detail: "Sessions with a retry scheduled" },
  { key: "due", label: "Due", detail: "Sessions currently due for processing" },
  { key: "expired", label: "Expired", detail: "Sessions past their expiry time" },
];

const safeReasonLabels: Record<string, string> = {
  pending: "Recovery check in progress",
  unconfirmed: "Outcome unconfirmed — waiting to retry",
  uploads_paused: "Uploads paused — space remains reserved",
  unknown_creation: "Storage initiation unconfirmed — review required",
  expired_uncertain: "Expired with uncertain storage outcome — review required",
  integrity: "File integrity conflict — review required",
  conflict: "Ownership or storage conflict — review required",
  denied: "Current upload permission denied — review required",
  lease_lost: "Recovery lock lost — waiting to retry",
  busy: "Upload busy — waiting to retry",
  unavailable: "Storage unavailable — waiting to retry",
  uncertain: "Storage outcome uncertain — waiting to retry",
  cleanup_pending: "Storage or cleanup unconfirmed — space remains reserved",
  other: "Other recorded reason",
};

function formatBytes(raw: string): string {
  const bytes = Number(raw);
  if (!Number.isFinite(bytes) || bytes < 0) return "Unavailable";
  if (bytes < 1_000_000) return `${Math.round(bytes).toLocaleString()} bytes`;
  return `${(bytes / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })} MB`;
}

function formatSampleTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function LoadingState() {
  return (
    <Card aria-label="Loading native upload diagnostics">
      <CardContent className="space-y-4 py-6">
        <div className="h-5 w-52 animate-pulse rounded bg-muted" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map(item => <div key={item} className="h-20 animate-pulse rounded-md bg-muted" />)}
        </div>
      </CardContent>
    </Card>
  );
}

export default function NativeUploadDiagnostics({ enabled }: { enabled: boolean }) {
  const query = useQuery<NativeUploadDiagnostics>({
    queryKey: diagnosticsKey,
    // The shared fetcher retries 503/network failures internally. Diagnostics
    // must make one bounded read per request, even when the database is busy.
    queryFn: async ({ signal }) => {
      const response = await fetch(diagnosticsKey[0], {
        credentials: "include", cache: "no-store",
        signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
      });
      if (!response.ok) throw new Error("Upload diagnostics unavailable");
      return response.json();
    },
    enabled,
    retry: false,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });

  if (!enabled) return null;
  if (query.isLoading) return <LoadingState />;

  if (query.isError || !query.data) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div role="alert" className="flex min-w-0 items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="min-w-0">
              <h3 className="font-semibold">Native-upload diagnostics unavailable</h3>
              <p className="mt-1 break-words text-sm text-muted-foreground">
                The read-only status request failed. No cached result is shown as if it were current.
              </p>
            </div>
          </div>
          <Button className="w-full shrink-0 sm:w-auto" variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh status
          </Button>
        </CardContent>
      </Card>
    );
  }

  const diagnostics = query.data;
  if (diagnostics.availability === "not_development") {
    return (
      <Card>
        <CardContent className="flex min-w-0 items-start gap-3 py-6">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <h3 className="font-semibold">Native-upload diagnostics are development-only</h3>
            <p className="mt-1 break-words text-sm text-muted-foreground">
              This environment does not expose the development diagnostics sample.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (diagnostics.availability === "schema_unavailable") {
    return (
      <Card>
        <CardContent className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Database className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <h3 className="font-semibold">Native-upload schema unavailable</h3>
              <p className="mt-1 break-words text-sm text-muted-foreground">
                Diagnostics cannot be sampled because the required schema is unavailable. Feature flags below are configuration only, not readiness indicators.
              </p>
              <p className="mt-2 break-words text-sm">
                Native uploads: <strong>{diagnostics.nativeEnabled ? "enabled" : "disabled"}</strong>
                {" · "}Uploads: <strong>{diagnostics.uploadsEnabled ? "enabled" : "disabled"}</strong>
              </p>
            </div>
          </div>
          <Button className="w-full shrink-0 sm:w-auto" variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh status
          </Button>
        </CardContent>
      </Card>
    );
  }

  const reasons = Array.isArray(diagnostics.reasons) ? diagnostics.reasons : [];

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardContent className="space-y-5 p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Read-only · Development sample</p>
            <h3 className="mt-1 text-lg font-semibold">Native-upload diagnostics</h3>
            <p className="mt-1 break-words text-sm text-muted-foreground">
              A bounded sample of the oldest uncleaned native JPEG sessions. This is not a full inventory, provider integrity check, or rollout-readiness proof.
            </p>
          </div>
          <Button className="w-full shrink-0 sm:w-auto" variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
            {query.isFetching ? "Refreshing…" : "Refresh status"}
          </Button>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
          <span>Native uploads: <strong>{diagnostics.nativeEnabled ? "enabled" : "disabled"}</strong></span>
          <span>Uploads: <strong>{diagnostics.uploadsEnabled ? "enabled" : "disabled"}</strong></span>
          <span className="break-words text-muted-foreground">Sampled {formatSampleTime(diagnostics.sampledAt)}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Flags describe configuration only, not storage readiness. Held uploads need review;
          this view cannot force publication, retry or release reserved space.
        </p>

        <dl className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {countLabels.map(({ key, label, detail }) => (
            <div key={key} className="min-w-0 rounded-md border border-border p-3">
              <dt className="break-words text-sm text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">{diagnostics.counts[key].toLocaleString()}</dd>
              <p className="mt-1 break-words text-xs text-muted-foreground">{detail}</p>
            </div>
          ))}
        </dl>

        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <section className="min-w-0 rounded-md border border-border p-4">
            <h4 className="font-medium">Reserved storage in sample</h4>
            <p className="mt-2 break-words text-2xl font-semibold tabular-nums">{formatBytes(diagnostics.reservedBytes)}</p>
            <p className="mt-1 break-words text-xs text-muted-foreground">
              Sum of reserved bytes for sampled sessions only; not total system usage.
            </p>
          </section>
          <section className="min-w-0 rounded-md border border-border p-4">
            <h4 className="font-medium">Recorded reasons</h4>
            {reasons.length ? (
              <ul className="mt-2 space-y-2">
                {reasons.map((item, index) => (
                  <li key={`${item.reason}-${index}`} className="flex min-w-0 justify-between gap-3 text-sm">
                    <span className="min-w-0 break-words">{safeReasonLabels[item.reason] ?? "Other recorded reason"}</span>
                    <span className="shrink-0 font-medium tabular-nums">{item.count.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">No reason counts were reported.</p>
            )}
          </section>
        </div>

        {(diagnostics.truncated || diagnostics.counts.sessions >= diagnostics.sampleLimit) && (
          <p role="note" className="break-words rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            Sample limit reached: showing at most {diagnostics.sampleLimit.toLocaleString()} sessions. Counts describe this sample and may overlap (for example, expired and held statuses); they are not mutually exclusive totals.
          </p>
        )}

        {!diagnostics.truncated && diagnostics.counts.sessions < diagnostics.sampleLimit && (
          <p className="break-words text-xs text-muted-foreground">
            Counts can overlap (for example, expired and held statuses); do not add them together as unique sessions. No session identifiers or object keys are displayed.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
