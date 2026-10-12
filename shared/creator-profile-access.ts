type CreatorProfileAccount = {
  isAdmin?: boolean;
  isCreator?: boolean;
  creatorStatus?: string | null;
  suspended?: boolean;
};

/** Public profile availability, not permission to edit private account fields. */
export function hasActivePublicCreatorProfile(user: CreatorProfileAccount | null | undefined): boolean {
  return !!user && !user.suspended && user.creatorStatus !== "rejected" &&
    !!(user.isAdmin || user.isCreator || user.creatorStatus === "approved");
}
