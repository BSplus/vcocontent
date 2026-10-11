import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { events, nextcloudSources } from "@shared/schema";
import { encryptManifest, decryptManifest } from "./import-manifest";
import { NextcloudError, resolveSource, type SourceInput } from "./nextcloud";

export const sourceEdits = z.array(z.object({
  id: z.string().uuid().optional(),
  link: z.string().url().max(2048),
  password: z.string().max(256).optional(),
  removePassword: z.boolean().optional(),
})).max(10);
type SavedSource = SourceInput & { id: string };

export async function savedSourceInputs(eventId: number): Promise<SavedSource[]> {
  const [row] = await db.select().from(nextcloudSources).where(eq(nextcloudSources.eventId, eventId));
  return row ? decryptManifest<SavedSource[]>(row.encrypted) : [];
}
export async function readSources(eventId: number) {
  return (await savedSourceInputs(eventId)).map(({ id, link, password }) => ({
    id, link, hasPassword: !!password,
  }));
}
export function mergeSourceEdits(previous: SavedSource[], edits: z.infer<typeof sourceEdits>) {
  const ids = new Set<string>();
  return edits.map(edit => {
    const old = edit.id ? previous.find(source => source.id === edit.id) : undefined;
    if (edit.id && (!old || ids.has(edit.id))) throw new NextcloudError("Saved sources changed. Reopen the dialog.");
    if (edit.id) ids.add(edit.id);
    const source = { id: old?.id || randomUUID(), link: edit.link.trim(),
      password: edit.removePassword ? undefined : edit.password !== undefined ? edit.password : old?.password };
    resolveSource(source);
    return source;
  });
}
export async function saveSources(eventId: number, edits: z.infer<typeof sourceEdits>) {
  await db.transaction(async tx => {
    const [event] = await tx.select().from(events).where(eq(events.id, eventId)).for("update");
    if (!event || event.creatorId || event.isPremium)
      throw new NextcloudError("Sources are available for official VCO galleries only.");
    const [row] = await tx.select().from(nextcloudSources).where(eq(nextcloudSources.eventId, eventId));
    const previous = row ? decryptManifest<SavedSource[]>(row.encrypted) : [];
    const sources = mergeSourceEdits(previous, edits);
    await tx.insert(nextcloudSources).values({ eventId, encrypted: encryptManifest(sources) })
      .onConflictDoUpdate({ target: nextcloudSources.eventId, set: { encrypted: encryptManifest(sources) } });
  });
  return readSources(eventId);
}
