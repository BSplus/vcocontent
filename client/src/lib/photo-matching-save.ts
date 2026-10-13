import { photoMatchingSaveSchema, type PhotoMatchingChanges } from "@shared/photo-matching-settings";
import { EventSaveError } from "./event-save";

/** One attempt only. A transport failure cannot prove the transaction rolled back. */
export async function savePhotoMatchingSettings(id: number, changes: PhotoMatchingChanges) {
  try {
    const response = await fetch(`/api/events/${id}/photo-matching`, {
      method: "PATCH", credentials: "include", signal: AbortSignal.timeout(35000),
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(changes),
    });
    const body = await response.json();
    if (!response.ok && response.status >= 400 && response.status < 500 &&
      typeof body?.error === "string" &&
      (body.saveStatus === "rejected" || [401, 403, 404].includes(response.status)))
      throw new EventSaveError("rejected", body.error);
    const result = photoMatchingSaveSchema.safeParse(body);
    if (!response.ok || !result.success || result.data.id !== id)
      throw new EventSaveError("unknown", "The server did not confirm whether your settings were saved.");
    return result.data;
  } catch (reason) {
    if (reason instanceof EventSaveError) throw reason;
    throw new EventSaveError("unknown", "The connection or response failed. Your settings may already be saved.");
  }
}
