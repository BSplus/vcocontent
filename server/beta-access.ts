import type { Event, MediaItem } from "@shared/schema";
import { storage } from "./storage";
import { creatorAllowed, safeState } from "./beta-policy";
import { verificationConfigured } from "./beta-config";

export function canManage(user: Express.User | undefined, event: Pick<Event,"creatorId">) {
  return creatorAllowed(user) && !!user && (user.isAdmin || event.creatorId===user.id);
}
export async function eventPublic(event: Event | undefined) {
  if (!event) return false;
  if (event.adminHidden) return false;
  if (!event.creatorId) return true;
  const owner = await storage.getUser(event.creatorId);
  return !!owner && !owner.suspended && owner.creatorStatus!=="rejected" &&
    event.visibility==="published" && safeState(event) &&
    (event.safetyStatus==="legacy" || (!!owner.emailVerifiedAt && verificationConfigured()));
}
export async function mediaPublic(item: MediaItem, event: Event | undefined) {
  if (!await eventPublic(event)) return false;
  if (!event?.creatorId) return true;
  if (!safeState(item)) return false;
  if (item.safetyStatus==="legacy") return true;
  const owner = await storage.getUser(event.creatorId);
  return !!owner?.emailVerifiedAt && verificationConfigured();
}
export async function visibleEvents(list: Event[]) {
  const permitted = await Promise.all(list.map(eventPublic));
  return list.filter((_,index)=>permitted[index]);
}
