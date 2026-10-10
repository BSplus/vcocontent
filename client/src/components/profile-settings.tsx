import { useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "@shared/schema";
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
  const [pickedProfileBytes, setPickedProfileBytes] = useState(0);
  const [pickedCoverBytes, setPickedCoverBytes] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestLock = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const coverFileRef = useRef<HTMLInputElement>(null);

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
    setPickedProfileBytes(0);
    setPickedCoverBytes(0);
    setError("");
    setNotice("");
  }, [user.id]);

  const chooseImage = (file?: File, target: "profile" | "cover" = "profile") => {
    if (!file) return;
    setError("");
    setNotice("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Choose a JPEG, PNG, or WebP image.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (file.size > 1_000_000) {
      setError("The source image must be no larger than 1 MB.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    const profileBytes = target === "profile" ? file.size : pickedProfileBytes;
    const coverBytes = target === "cover" ? file.size : pickedCoverBytes;
    if (profileBytes + coverBytes > 1_400_000) {
      setError("Choose profile and cover images separately, or keep their combined source size under 1.4 MB.");
      if (target === "cover" && coverFileRef.current) coverFileRef.current.value = "";
      if (target === "profile" && fileRef.current) fileRef.current.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        setError("This image could not be read. Choose another file.");
        return;
      }
      if (target === "profile") {
        setProfileImage(reader.result);
        setImageChanged(true);
        setPickedProfileBytes(file.size);
      } else {
        setCoverImage(reader.result);
        setCoverChanged(true);
        setPickedCoverBytes(file.size);
      }
    };
    reader.onerror = () => setError("This image could not be read. Choose another file.");
    reader.readAsDataURL(file);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (requestLock.current || !user.id) return;
    const cleanUsername = username.trim();
    const cleanBio = bio.trim();
    if (cleanUsername.length < 3 || cleanUsername.length > 80) {
      setError("Username must be between 3 and 80 characters.");
      return;
    }
    if (cleanBio.length > 500) {
      setError("Biography cannot be longer than 500 characters.");
      return;
    }
    if (canEditCreatorProfile && publicContactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(publicContactEmail.trim())) {
      setError("Enter a valid public contact email, or leave it blank.");
      return;
    }
    const validExternalUrl = (value: string) => !value.trim() || /^https:\/\/[^\s]+$/i.test(value.trim());
    if (canEditCreatorProfile && (!validExternalUrl(websiteUrl) || !validExternalUrl(instagramUrl))) {
      setError("Website and Instagram links must use a full https:// URL.");
      return;
    }
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
    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Profile changes could not be saved.");
      const updatedUser = result as User;
      if (queryClient.getQueryData<User | null>(["/api/user"])?.id === userId) {
        queryClient.setQueryData(["/api/user"], updatedUser);
      }
      await Promise.all([
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
      setPickedProfileBytes(0);
      setPickedCoverBytes(0);
      if (fileRef.current) fileRef.current.value = "";
      if (coverFileRef.current) coverFileRef.current.value = "";
      setNotice("Your profile was updated. Public changes follow the moderation review.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Profile changes could not be saved. Try again.");
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
      <form className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,.65fr)]" onSubmit={save}>
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="profile-username">Username</Label>
            <Input id="profile-username" name="username" autoComplete="nickname" minLength={3} maxLength={80} required value={username} onChange={event => setUsername(event.target.value)} disabled={isSaving} />
            <p className="text-xs text-muted-foreground">3–80 characters. This remains your sign-in username and stable profile URL.</p>
          </div>
          {canEditCreatorProfile && <div className="space-y-2"><Label htmlFor="profile-display-name">Public display name</Label><Input id="profile-display-name" maxLength={100} value={displayName} onChange={event => setDisplayName(event.target.value)} disabled={isSaving} placeholder={user.username} /><p className="text-xs text-muted-foreground">Leave blank to show your username.</p></div>}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3"><Label htmlFor="profile-bio">Biography</Label><span className="text-xs text-muted-foreground">{bio.length}/500</span></div>
            <Textarea id="profile-bio" name="bio" maxLength={500} rows={5} value={bio} onChange={event => setBio(event.target.value)} disabled={isSaving} placeholder="A short introduction for your VCO profile" />
          </div>
          {canEditCreatorProfile && <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="profile-public-email">Public contact email (optional)</Label><Input id="profile-public-email" type="email" autoComplete="off" value={publicContactEmail} onChange={event => setPublicContactEmail(event.target.value)} disabled={isSaving} placeholder="contact@example.com" /><p className="text-xs text-muted-foreground">Only the address you enter here appears publicly.</p></div>
            <div className="space-y-2"><Label htmlFor="profile-website">Website (optional)</Label><Input id="profile-website" type="url" value={websiteUrl} onChange={event => setWebsiteUrl(event.target.value)} disabled={isSaving} placeholder="https://example.com" /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="profile-instagram">Instagram profile URL (optional)</Label><Input id="profile-instagram" type="url" value={instagramUrl} onChange={event => setInstagramUrl(event.target.value)} disabled={isSaving} placeholder="https://instagram.com/yourname" /></div>
          </div>}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" className="vco-button min-h-11 bg-primary text-primary-foreground" disabled={isSaving || username.trim().length < 3}>
              {isSaving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              {isSaving ? "Saving profile…" : "Save profile"}
            </Button>
            {(imageChanged || coverChanged) && <span className="text-xs text-muted-foreground">Selected image changes included</span>}
          </div>
          {error && <p role="alert" className="border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
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
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">JPEG, PNG, or WebP · source up to 1 MB. The server resizes and reviews the image.</p>
            </div>
          </div>
          <input ref={fileRef} id="profile-image" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={isSaving} onChange={event => chooseImage(event.currentTarget.files?.[0], "profile")} />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="min-h-11" disabled={isSaving} onClick={() => fileRef.current?.click()}><ImagePlus className="mr-2 h-4 w-4" />Choose image</Button>
            {profileImage && <Button type="button" variant="outline" className="min-h-11" disabled={isSaving} onClick={() => { setProfileImage(null); setImageChanged(true); setPickedProfileBytes(0); setNotice(""); if (fileRef.current) fileRef.current.value = ""; }}><Trash2 className="mr-2 h-4 w-4" />Remove photo</Button>}
          </div>
          {canEditCreatorProfile && <div className="mt-7 border-t border-border pt-6">
            <Label className="mb-3 block" htmlFor="profile-cover">Creator cover image</Label>
            <div className="relative aspect-[2.7/1] overflow-hidden border border-border bg-secondary">
              {coverImage ? <img src={coverImage} alt="Creator cover preview" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center gap-2 text-muted-foreground"><ImageIcon className="h-5 w-5" />No cover image</div>}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">JPEG, PNG, or WebP · up to 1 MB. Changed profile and cover source files must total no more than 1.4 MB.</p>
            <input ref={coverFileRef} id="profile-cover" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={isSaving} onChange={event => chooseImage(event.currentTarget.files?.[0], "cover")} />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="min-h-11" disabled={isSaving} onClick={() => coverFileRef.current?.click()}><ImagePlus className="mr-2 h-4 w-4" />Choose cover</Button>
              {coverImage && <Button type="button" variant="outline" className="min-h-11" disabled={isSaving} onClick={() => { setCoverImage(null); setCoverChanged(true); setPickedCoverBytes(0); setNotice(""); if (coverFileRef.current) coverFileRef.current.value = ""; }}><Trash2 className="mr-2 h-4 w-4" />Remove cover</Button>}
            </div>
          </div>}
        </aside>
      </form>
    </section>
  );
}
