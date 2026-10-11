import { useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "@shared/schema";
import { PROFILE_IMAGE_SOURCE_BYTES } from "@shared/profile-image-limits";
import { profileUpdateSchema } from "@shared/profile-validation";
import { profileFields, profileMessages, profileImageMessage, type ProfileField, type ProfileFieldErrors } from "@shared/profile-errors";
import { readProfileFailure } from "@/lib/profile-errors";
import { Check, ImagePlus, LoaderCircle, Trash2, UserRound, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { queryClient } from "@/lib/queryClient";

interface ProfileSettingsProps {
  user: User;
}

type CreatorProfileFields = {
  displayName?: string | null;
  coverImage?: string | null;
  publicContactEmail?: string | null;
  websiteUrl?: string | null;
  instagramUrl?: string | null;
};

export default function ProfileSettings({ user }: ProfileSettingsProps) {
  const creatorUser = user as User & CreatorProfileFields;
  const canEditCreatorProfile = Boolean(!user.suspended && (user.isAdmin ||
    (user.creatorStatus !== "rejected" && (user.isCreator || user.creatorStatus === "approved"))));
  const [username, setUsername] = useState(user.username);
  const [bio, setBio] = useState(user.bio ?? "");
  const [profileImage, setProfileImage] = useState<string | null>(user.profileImage ?? null);
  const [coverImage, setCoverImage] = useState<string | null>(user.profileCoverImage ?? null);
  const [displayName, setDisplayName] = useState(creatorUser.displayName ?? "");
  const [publicContactEmail, setPublicContactEmail] = useState(creatorUser.publicContactEmail ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(creatorUser.websiteUrl ?? "");
  const [instagramUrl, setInstagramUrl] = useState(creatorUser.instagramUrl ?? "");
  const [imageChanged, setImageChanged] = useState(false);
  const [coverChanged, setCoverChanged] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ProfileFieldErrors>({});
  const [hadFieldErrors, setHadFieldErrors] = useState(false);
  const [notice, setNotice] = useState("");
  const requestLock = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const coverFileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const fieldIds: Record<ProfileField, string> = { username: "profile-username", displayName: "profile-display-name", bio: "profile-bio", publicContactEmail: "profile-public-email", websiteUrl: "profile-website", instagramUrl: "profile-instagram", profileImage: "profile-image-action", coverImage: "profile-cover-action" };
  const fieldProps = (field: ProfileField) => ({
    "aria-invalid": !!fieldErrors[field],
    "aria-describedby": fieldErrors[field] ? `${fieldIds[field]}-error` : undefined,
  });
  const fieldMessage = (field: ProfileField) => fieldErrors[field] && <p id={`${fieldIds[field]}-error`} className="text-sm text-destructive">{fieldErrors[field]}</p>;
  const clearField = (field: ProfileField, value?: string) => {
    setFieldErrors(current => {
      if (value !== undefined && current[field]) {
        const parsed = profileUpdateSchema.safeParse({ username: "valid", bio: "", [field]: value });
        if (!parsed.success && parsed.error.issues.some(issue => issue.path[0] === field)) return current;
      }
      const next = { ...current }; delete next[field]; return next;
    });
    setNotice("");
  };
  const showFailure = (message: string, fields: ProfileFieldErrors = {}) => {
    setError(message); setFieldErrors(fields); setNotice("");
    setHadFieldErrors(Object.keys(fields).length > 0);
    // Wait for disabled controls to be re-enabled after the request finishes.
    setTimeout(() => {
      const first = profileFields.find(field => fields[field]);
      if (first) formRef.current?.querySelector<HTMLElement>(`#${fieldIds[first]}`)?.focus();
      else summaryRef.current?.focus();
    }, 0);
  };

  useEffect(() => {
    setUsername(user.username);
    setBio(user.bio ?? "");
    setProfileImage(user.profileImage ?? null);
    const publicProfile = user as User & CreatorProfileFields;
    setCoverImage(user.profileCoverImage ?? null);
    setDisplayName(publicProfile.displayName ?? "");
    setPublicContactEmail(publicProfile.publicContactEmail ?? "");
    setWebsiteUrl(publicProfile.websiteUrl ?? "");
    setInstagramUrl(publicProfile.instagramUrl ?? "");
    setImageChanged(false);
    setCoverChanged(false);
    setError("");
    setFieldErrors({});
    setHadFieldErrors(false);
    setNotice("");
  }, [user.id]);

  const chooseImage = (file?: File, target: "profile" | "cover" = "profile") => {
    if (!file) return;
    const input = target === "profile" ? fileRef : coverFileRef;
    setNotice("");
    const field = target === "profile" ? "profileImage" : "coverImage";
    const imageFailure = (reason: "format" | "size" | "unreadable") => {
      setFieldErrors(current => ({ ...current, [field]: profileImageMessage(field, reason) }));
      setHadFieldErrors(true);
      setError(profileMessages.validation);
    };
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      imageFailure("format");
      if (input.current) input.current.value = "";
      return;
    }
    if (file.size > PROFILE_IMAGE_SOURCE_BYTES) {
      imageFailure("size");
      if (input.current) input.current.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        imageFailure("unreadable");
        return;
      }
      clearField(field);
      if (target === "profile") {
        setProfileImage(reader.result);
        setImageChanged(true);
      } else {
        setCoverImage(reader.result);
        setCoverChanged(true);
      }
    };
    reader.onerror = () => imageFailure("unreadable");
    reader.readAsDataURL(file);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (requestLock.current || !user.id) return;
    const cleanUsername = username.trim();
    const cleanBio = bio.trim();
    requestLock.current = true;
    setIsSaving(true);
    setError("");
    setNotice("");
    const userId = user.id;
    const body = {
      username: cleanUsername,
      bio: cleanBio,
      ...(imageChanged ? { profileImage } : {}),
      ...(canEditCreatorProfile ? {
        ...(coverChanged ? { coverImage } : {}),
        displayName: displayName.trim() || null,
        publicContactEmail: publicContactEmail.trim() || null,
        websiteUrl: websiteUrl.trim() || null,
        instagramUrl: instagramUrl.trim() || null,
      } : {}),
    };
    const parsed = profileUpdateSchema.safeParse(body);
    const localErrors: ProfileFieldErrors = {};
    if (!parsed.success) for (const field of profileFields) {
      const issue = parsed.error.issues.find(issue => issue.path[0] === field);
      if (issue) localErrors[field] = issue.message;
    }
    if (Object.keys(localErrors).length) {
      requestLock.current = false; setIsSaving(false);
      showFailure(profileMessages.validation, localErrors); return;
    }
    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const failure = readProfileFailure(response.status, result);
        showFailure(failure.message, failure.fields); return;
      }
      if (!result || result.id !== userId || typeof result.username !== "string") {
        showFailure(profileMessages.connection); return;
      }
      const updatedUser = result as User;
      if (queryClient.getQueryData<User | null>(["/api/user"])?.id === userId) {
        queryClient.setQueryData(["/api/user"], updatedUser);
      }
      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: [`/api/users/${userId}`] }),
        queryClient.invalidateQueries({ queryKey: ["/api/account/following"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/user"] }),
      ]);
      setUsername(updatedUser.username);
      setBio(updatedUser.bio ?? "");
      setProfileImage(updatedUser.profileImage ?? null);
      const publicProfile = updatedUser as User & CreatorProfileFields;
      setCoverImage(updatedUser.profileCoverImage ?? null);
      setDisplayName(publicProfile.displayName ?? "");
      setPublicContactEmail(publicProfile.publicContactEmail ?? "");
      setWebsiteUrl(publicProfile.websiteUrl ?? "");
      setInstagramUrl(publicProfile.instagramUrl ?? "");
      setImageChanged(false);
      setCoverChanged(false);
      setFieldErrors({});
      if (fileRef.current) fileRef.current.value = "";
      if (coverFileRef.current) coverFileRef.current.value = "";
      setNotice("Your profile was updated. Public changes follow the moderation review.");
    } catch {
      showFailure(profileMessages.connection);
    } finally {
      requestLock.current = false;
      setIsSaving(false);
    }
  };

  return (
    <section className="border border-border bg-card p-5 sm:p-7" aria-labelledby="profile-settings-heading">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div><p className="vco-kicker">Public profile</p><h2 id="profile-settings-heading" className="mt-3 text-2xl">Profile settings</h2><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Your sign-in username stays yours. Public display name, contact and portfolio links are optional; your private account email is never copied here.</p></div>
        <div className="hidden h-10 w-10 shrink-0 items-center justify-center border border-primary/30 bg-primary/10 text-primary sm:flex"><UserRound aria-hidden="true" className="h-5 w-5" /></div>
      </div>
      <form ref={formRef} noValidate className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,.65fr)]" onSubmit={save}>
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="profile-username">Username</Label>
            <Input {...fieldProps("username")} id="profile-username" name="username" autoComplete="nickname" minLength={3} maxLength={80} required value={username} onChange={event => { setUsername(event.target.value); clearField("username", event.target.value); }} disabled={isSaving} />
            {fieldMessage("username")}
            <p className="text-xs text-muted-foreground">3–80 characters. This remains your sign-in username and stable profile URL.</p>
          </div>
          {canEditCreatorProfile && <div className="space-y-2"><Label htmlFor="profile-display-name">Public display name</Label><Input {...fieldProps("displayName")} id="profile-display-name" maxLength={80} value={displayName} onChange={event => { setDisplayName(event.target.value); clearField("displayName", event.target.value); }} disabled={isSaving} placeholder={user.username} />{fieldMessage("displayName")}<p className="text-xs text-muted-foreground">Leave blank to show your username. Up to 80 characters; this is not your sign-in username.</p></div>}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3"><Label htmlFor="profile-bio">Biography</Label><span className="text-xs text-muted-foreground">{bio.length}/500</span></div>
            <Textarea {...fieldProps("bio")} id="profile-bio" name="bio" maxLength={500} rows={5} value={bio} onChange={event => { setBio(event.target.value); clearField("bio", event.target.value); }} disabled={isSaving} placeholder="A short introduction for your VCO profile" />
            {fieldMessage("bio")}
          </div>
          {canEditCreatorProfile && <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="profile-public-email">Public contact email (optional)</Label><Input {...fieldProps("publicContactEmail")} id="profile-public-email" type="email" autoComplete="off" value={publicContactEmail} onChange={event => { setPublicContactEmail(event.target.value); clearField("publicContactEmail", event.target.value); }} disabled={isSaving} placeholder="contact@example.com" />{fieldMessage("publicContactEmail")}<p className="text-xs text-muted-foreground">Only the address you enter here appears publicly.</p></div>
            <div className="space-y-2"><Label htmlFor="profile-website">Website (optional)</Label><Input {...fieldProps("websiteUrl")} id="profile-website" type="url" value={websiteUrl} onChange={event => { setWebsiteUrl(event.target.value); clearField("websiteUrl", event.target.value); }} disabled={isSaving} placeholder="https://example.com" />{fieldMessage("websiteUrl")}</div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="profile-instagram">Instagram profile URL (optional)</Label><Input {...fieldProps("instagramUrl")} id="profile-instagram" type="url" value={instagramUrl} onChange={event => { setInstagramUrl(event.target.value); clearField("instagramUrl", event.target.value); }} disabled={isSaving} placeholder="https://instagram.com/yourname" />{fieldMessage("instagramUrl")}</div>
          </div>}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" className="vco-button min-h-11 bg-primary text-primary-foreground" disabled={isSaving}>
              {isSaving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              {isSaving ? "Saving profile…" : "Save profile"}
            </Button>
            {(imageChanged || coverChanged) && <span className="text-xs text-muted-foreground">Selected image changes included</span>}
          </div>
          {error && <div ref={summaryRef} tabIndex={-1} role="alert" className="border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"><p>{hadFieldErrors && !Object.keys(fieldErrors).length ? "Your corrections are ready. Try saving again." : error}</p>{Object.entries(fieldErrors).length > 0 && <ul className="mt-2 space-y-1">{profileFields.filter(field => fieldErrors[field]).map(field => <li key={field}><button type="button" className="text-left underline" onClick={() => formRef.current?.querySelector<HTMLElement>(`#${fieldIds[field]}`)?.focus()}>{fieldErrors[field]}</button></li>)}</ul>}<p className="mt-2">Your entries and selected previews are kept here.</p></div>}
          {notice && <p role="status" aria-live="polite" className="border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-accent">{notice}</p>}
        </div>
        <aside className="border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <Label className="mb-3 block" htmlFor="profile-image">Profile photo</Label>
          <div className="flex items-center gap-4">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-primary/40 bg-primary/10 text-primary">
              {profileImage ? <img src={profileImage} alt="Profile photo preview" className="h-full w-full object-cover" /> : <UserRound aria-hidden="true" className="h-8 w-8" />}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{profileImage ? "Photo selected" : "No profile photo"}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">JPEG, PNG, or WebP · source up to 3 MB per image. The server resizes and reviews the image.</p>
            </div>
          </div>
          <input ref={fileRef} id="profile-image" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={isSaving} onChange={event => chooseImage(event.currentTarget.files?.[0], "profile")} />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button {...fieldProps("profileImage")} id="profile-image-action" type="button" variant="outline" className="min-h-11" disabled={isSaving} onClick={() => fileRef.current?.click()}><ImagePlus className="mr-2 h-4 w-4" />Choose image</Button>
            {profileImage && <Button type="button" variant="outline" className="min-h-11" disabled={isSaving} onClick={() => { clearField("profileImage"); setProfileImage(null); setImageChanged(true); setNotice(""); if (fileRef.current) fileRef.current.value = ""; }}><Trash2 className="mr-2 h-4 w-4" />Remove photo</Button>}
          </div>
          {fieldMessage("profileImage")}
          {canEditCreatorProfile && <div className="mt-7 border-t border-border pt-6">
            <Label className="mb-3 block" htmlFor="profile-cover">Creator cover image</Label>
            <div className="relative aspect-[2.7/1] overflow-hidden border border-border bg-secondary">
              {coverImage ? <img src={coverImage} alt="Creator cover preview" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center gap-2 text-muted-foreground"><ImageIcon className="h-5 w-5" />No cover image</div>}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">JPEG, PNG, or WebP · source up to 3 MB per image. Profile photo and cover can be saved together.</p>
            <input ref={coverFileRef} id="profile-cover" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={isSaving} onChange={event => chooseImage(event.currentTarget.files?.[0], "cover")} />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button {...fieldProps("coverImage")} id="profile-cover-action" type="button" variant="outline" className="min-h-11" disabled={isSaving} onClick={() => coverFileRef.current?.click()}><ImagePlus className="mr-2 h-4 w-4" />Choose cover</Button>
              {coverImage && <Button type="button" variant="outline" className="min-h-11" disabled={isSaving} onClick={() => { clearField("coverImage"); setCoverImage(null); setCoverChanged(true); setNotice(""); if (coverFileRef.current) coverFileRef.current.value = ""; }}><Trash2 className="mr-2 h-4 w-4" />Remove cover</Button>}
            </div>
            {fieldMessage("coverImage")}
          </div>}
        </aside>
      </form>
    </section>
  );
}
