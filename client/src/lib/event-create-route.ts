export function eventCreateRoute(
  user: { isAdmin?: boolean; isCreator?: boolean; creatorStatus?: string | null; id: number } | null | undefined,
  imageSource: "local" | "nextcloud",
): { endpoint: string; creatorId?: number } {
  // An admin album must not inherit the creator role of a dual-role user.
  if (imageSource === "nextcloud" && user?.isAdmin) return { endpoint: "/api/events" };
  if (user && (user.isCreator || user.creatorStatus === "approved"))
    return { endpoint: "/api/creator/events", creatorId: user.id };
  return { endpoint: "/api/events" };
}