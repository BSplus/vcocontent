---
name: Public creator profile continuity
description: Preserve existing creator links and account identity when extending public profiles.
---

Keep existing creator profile URLs stable rather than introducing mandatory slugs, and treat the public display name separately from the account login name.

**Why:** The user requested reuse of existing Creator, gallery and authentication infrastructure with the smallest necessary changes. Existing public links and sign-in expectations must not break when a photographer changes their public presentation.

**How to apply:** Future portfolio or branding work must preserve old profile links and must not silently rename the login account. Optional public contact information remains explicitly supplied, never derived from the private account email.

Review each changed profile image independently and preserve the previous public profile when any required review fails.

**Why:** An approved avatar says nothing about a new cover's content. The existing beta safety boundary also applies to portfolio presentation.

**How to apply:** Do not use a single image's approval to publish a multi-image profile update; apply the whole approved edit atomically and include retained covers in the existing storage allowance.

Own profile edits must not require manual administrator approval; keep the automatic safety check.

**Why:** The operator explicitly wants users and creators to publish their own profile changes without manual approval, not to remove or loosen safety checks.

**How to apply:** Keep profile edits separate from gallery/media moderation. An uncertain profile check should invite adjustment and another save, not promise an administrator approval queue. Creator activation and real storage/access issues remain separate.
