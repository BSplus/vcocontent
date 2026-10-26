import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Eye, UserRound, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useAuth } from "@/hooks/use-auth";
import { pluralize } from "@/lib/utils";

export type PublicCreator = {
  id: number;
  username: string;
  displayName?: string | null;
  isCreator?: boolean;
  bio?: string | null;
  profileImage?: string | null;
  followerCount?: number;
  following?: boolean;
};

export default function CreatorIdentity({ creator, className = "" }: { creator: PublicCreator; className?: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopOpen, setDesktopOpen] = useState(false);
  const profileKey = [`/api/users/${creator.id}`, user?.id ?? "signed-out"];
  const { data, isFetching, isError } = useQuery<PublicCreator>({
    queryKey: profileKey,
    enabled: Boolean(creator.id) && (desktopOpen || mobileOpen),
    initialData: creator,
    initialDataUpdatedAt: 0,
    staleTime: 15000,
    retry: false,
  });
  const label = (data?.displayName ?? creator.displayName)?.trim() || data?.username || creator.username;
  const follow = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/creators/${creator.id}/follow`, {
        method: data?.following ? "DELETE" : "PUT",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Follow action could not be completed.");
      return result as { followerCount: number; following: boolean };
    },
    onSuccess: async result => {
      queryClient.setQueryData<PublicCreator>(profileKey, current => current ? { ...current, ...result } : current);
      await queryClient.invalidateQueries({ queryKey: [`/api/users/${creator.id}`] });
      await queryClient.invalidateQueries({ queryKey: ["/api/account/following"] });
    },
  });
  const preview = <div className="w-[min(19rem,calc(100vw-2rem))] border border-border bg-card p-4 shadow-xl">
    <div className="flex items-center gap-3">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-primary/40 bg-primary/10 text-primary">
        {data?.profileImage ? <img src={data.profileImage} alt="" className="h-full w-full object-cover" /> : <UserRound className="h-5 w-5" />}
      </div>
      <div className="min-w-0"><p className="truncate font-bold">{label}</p><p className="truncate text-xs text-muted-foreground">@{creator.username}</p></div>
    </div>
    {data?.bio && <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-foreground/75">{data.bio}</p>}
    <p className="mt-3 flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground"><Users className="h-3.5 w-3.5 text-primary" />{data?.followerCount ?? "—"} {pluralize(data?.followerCount, "follower", "followers")}</p>
    {follow.isError && <p role="alert" className="mt-2 text-xs text-destructive">{follow.error.message}</p>}
    {isError && <p role="alert" className="mt-2 text-xs text-destructive">Profile preview could not be loaded. Open the profile to try again.</p>}
    <div className="mt-4 grid grid-cols-2 gap-2">
      {user ? <Button type="button" size="sm" variant={data?.following ? "outline" : "default"} disabled={isFetching || isError || data?.following===undefined || follow.isPending || user.id === creator.id} onClick={() => follow.mutate()}>
        {user.id === creator.id ? "Your profile" : follow.isPending ? "Saving…" : data?.following ? "Following" : "Follow"}
      </Button> : <Button asChild size="sm"><Link href="/auth">Sign in to follow</Link></Button>}
      <Button asChild size="sm" variant="outline"><Link href={`/creator/${creator.id}`}>View profile <ArrowUpRight className="ml-1 h-3.5 w-3.5" /></Link></Button>
    </div>
  </div>;

  return <span className={`relative inline-flex min-w-0 items-center gap-1.5 ${className}`}>
    <Link href={`/creator/${creator.id}`} className="min-w-0 truncate underline decoration-transparent underline-offset-4 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary md:hidden">{label}</Link>
    <HoverCard open={desktopOpen} onOpenChange={setDesktopOpen} openDelay={250} closeDelay={120}>
      <HoverCardTrigger asChild><Link href={`/creator/${creator.id}`} className="hidden min-w-0 truncate underline decoration-transparent underline-offset-4 transition-colors hover:text-primary hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:inline">{label}</Link></HoverCardTrigger>
      <HoverCardContent className="w-auto border-0 bg-transparent p-0 shadow-none">{preview}</HoverCardContent>
    </HoverCard>
    <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
      <DialogTrigger asChild><button type="button" aria-label={`Preview ${label}'s creator profile`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-current/75 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:hidden"><Eye className="h-4 w-4" /></button></DialogTrigger>
      <DialogContent className="max-w-sm border-border bg-card p-0">
        <DialogHeader className="sr-only"><DialogTitle>{label} profile preview</DialogTitle></DialogHeader>
        {preview}
      </DialogContent>
    </Dialog>
  </span>;
}
