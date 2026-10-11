export class EventSaveError extends Error {
  constructor(public readonly status: "rejected" | "unknown", message: string) {
    super(message);
  }
}
export type EventSaveResult = { id: number; saveStatus: "saved" | "unchanged"; safetyCheckStatus?: string };

/** Single attempt: an absent or invalid acknowledgement cannot prove rollback. */
export async function saveEvent(id: number, changes: Record<string, unknown>): Promise<EventSaveResult> {
  if (!Object.keys(changes).length) return { id, saveStatus: "unchanged" };
  try {
    const res = await fetch(`/api/events/${id}`, {
      method: "PUT", credentials: "include", signal: AbortSignal.timeout(35000),
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(changes),
    });
    const result = await res.json();
    if (!res.ok && res.status >= 400 && res.status < 500 && typeof result.error === "string")
      throw new EventSaveError("rejected", result.error);
    if (!res.ok || result?.id !== id || !["saved", "unchanged"].includes(result.saveStatus))
      throw new EventSaveError("unknown", "The server did not confirm whether your changes were saved.");
    return result;
  } catch (error) {
    if (error instanceof EventSaveError) throw error;
    throw new EventSaveError("unknown", "The connection or response failed. Your changes may already be saved.");
  }
}
