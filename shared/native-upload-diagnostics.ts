/** Aggregate-only operational view; never includes upload IDs or object keys. */
export type NativeUploadDiagnostics = {
  availability: "ready" | "schema_unavailable" | "not_development";
  nativeEnabled: boolean;
  uploadsEnabled: boolean;
  sampledAt: string;
  sampleLimit: number;
  truncated: boolean;
  counts: {
    sessions: number;
    receiving: number;
    finalizing: number;
    completedAwaitingCleanup: number;
    held: number;
    retryScheduled: number;
    due: number;
    expired: number;
  };
  reservedBytes: string;
  reasons: { reason: string; count: number }[];
};
