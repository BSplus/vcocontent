import { useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "@shared/schema";
import { Check, ImagePlus, LoaderCircle, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { queryClient } from "@/lib/queryClient";

interface ProfileSettingsProps {
  user: User;
}

export default function ProfileSettings({ user }: ProfileSettingsProps) {
  const [username, setUsername] = useState(user.username);
  const [bio, setBio] = useState(user.bio ?? "");
  const [profileImage, setProfileImage] = useState<string | null>(user.profileImage ?? null);
  const [imageChanged, setImageChanged] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestLock = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setUsername(user.username);
    setBio(user.bio ?? "");
    setProfileImage(user.profileImage ?? null);
    setImageChanged(false);
    setError("");
    setNotice("");
  }, [user.id]);

  const chooseImage = (file?: File) => {
    if (!file) return;
    setError("");
    setNotice("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Choose a JPEG, PNG, or WebP image.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (file.size > 1024 * 1024) {
      setError("The source image must be no larger than 1 MB.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        setError("This image could not be read. Choose another file.");
        return;
      }
      setProfileImage(reader.result);
      setImageChanged(true);
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
    requestLock.current = true;
    setIsSaving(true);
    setError("");
    setNotice("");
    const userId = user.id;
    const body = {
      username: cleanUsername,
      bio: cleanBio,
      ...(imageChanged ? { profileImage } : {}),
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
      void queryClient.invalidateQueries({ queryKey: [`/api/users/${userId}`] });
      setUsername(updatedUser.username);
      setBio(updatedUser.bio ?? "");
      setProfileImage(updatedUser.profileImage ?? null);
      setImageChanged(false);
      if (fileRef.current) fileRef.current.value = "";
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
        <div><p className="vco-kicker">Public profile</p><h2 id="profile-settings-heading" className="mt-3 text-2xl">Profile settings</h2><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Updates are checked before public profile details appear. Email, roles, and payment information cannot be changed here.</p></div>
        <div className="hidden h-10 w-10 shrink-0 items-center justify-center border border-primary/30 bg-primary/10 text-primary sm:flex"><UserRound aria-hidden="true" className="h-5 w-5" /></div>
      </div>
      <form className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,.65fr)]" onSubmit={save}>
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="profile-username">Username</Label>
            <Input id="profile-username" name="username" autoComplete="nickname" minLength={3} maxLength={80} required value={username} onChange={event => setUsername(event.target.value)} disabled={isSaving} />
            <p className="text-xs text-muted-foreground">3–80 characters. This is both your public name and your sign-in username. Changes are checked before saving.</p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3"><Label htmlFor="profile-bio">Biography</Label><span className="text-xs text-muted-foreground">{bio.length}/500</span></div>
            <Textarea id="profile-bio" name="bio" maxLength={500} rows={5} value={bio} onChange={event => setBio(event.target.value)} disabled={isSaving} placeholder="A short introduction for your VCO profile" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" className="vco-button min-h-11 bg-primary text-primary-foreground" disabled={isSaving || username.trim().length < 3}>
              {isSaving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              {isSaving ? "Saving profile…" : "Save profile"}
            </Button>
            {imageChanged && <span className="text-xs text-muted-foreground">Profile photo change included</span>}
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
          <input ref={fileRef} id="profile-image" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={isSaving} onChange={event => chooseImage(event.currentTarget.files?.[0])} />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="min-h-11" disabled={isSaving} onClick={() => fileRef.current?.click()}><ImagePlus className="mr-2 h-4 w-4" />Choose image</Button>
            {profileImage && <Button type="button" variant="outline" className="min-h-11" disabled={isSaving} onClick={() => { setProfileImage(null); setImageChanged(true); setNotice(""); if (fileRef.current) fileRef.current.value = ""; }}><Trash2 className="mr-2 h-4 w-4" />Remove photo</Button>}
          </div>
        </aside>
      </form>
    </section>
  );
}
