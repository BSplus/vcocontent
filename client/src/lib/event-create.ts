export class EventCreateError extends Error {
  constructor(public readonly status: "rejected" | "unknown", message: string) {
    super(message);
  }
}

/** Do not replay creation when its acknowledgement is lost. */
export async function createEventRequest<T extends { id: number }>(endpoint: string, body: unknown): Promise<T> {
  try {
    const response = await fetch(endpoint, {
      method: "POST", credentials: "include", signal: AbortSignal.timeout(35000),
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => null);
    if (response.status >= 400 && response.status < 500) {
      const fallback = response.status === 401 ? "Your session has expired. Sign in again." :
        response.status === 403 ? "Your account cannot create this event. Check your Creator approval or admin access." :
        response.status === 413 ? "The event image is too large. Choose an image smaller than 1 MiB." :
        response.status === 429 ? "Too many creation requests. Wait before trying again." :
        "Check the event details and try again.";
      throw new EventCreateError("rejected", typeof result?.error === "string" ? result.error : fallback);
    }
    if (!response.ok || !Number.isSafeInteger(result?.id) || result.id <= 0)
      throw new EventCreateError("unknown", "The server did not confirm whether the event was created.");
    return result;
  } catch (error) {
    if (error instanceof EventCreateError) throw error;
    throw new EventCreateError("unknown", "The connection or response failed. The event may already exist.");
  }
}
