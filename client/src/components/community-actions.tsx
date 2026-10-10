import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { Heart, Bookmark, LoaderCircle } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";

type CommunityKind = "media" | "event";
type CommunityState = { count: number; liked: boolean; saved: boolean };
type CommunityMutation = {
  action: "like" | "favorite";
  active: boolean;
  queryKey: (string | number)[];
  userId: number;
  kind: CommunityKind;
  id: number;
};

interface CommunityActionsProps {
  kind: CommunityKind;
  id: number;
  title?: string;
  compact?: boolean;
  onFavoriteChange?: () => void;
}

export default function CommunityActions({
  kind,
  id,
  title,
  compact = false,
  onFavoriteChange,
}: CommunityActionsProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const requestLock = useRef(false);
  const queryKey = [`/api/community/${kind}/${id}`, user?.id ?? "guest", kind, id];
  const { data, isLoading, isError, refetch } = useQuery<CommunityState>({
    queryKey,
    enabled: Number.isSafeInteger(id) && id > 0,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: async ({ action, active, kind: targetKind, id: targetId }: CommunityMutation) => {
      const response = await apiRequest(active ? "PUT" : "DELETE", `/api/community/${targetKind}/${targetId}/${action}`);
      return response.json() as Promise<CommunityState>;
    },
    retry: false,
    onMutate: async ({ action, active, queryKey: targetQueryKey, userId }) => {
      requestLock.current = true;
      await queryClient.cancelQueries({ queryKey: targetQueryKey });
      const previous = queryClient.getQueryData<CommunityState>(targetQueryKey);
      const current = previous ?? { count: 0, liked: false, saved: false };
      queryClient.setQueryData<CommunityState>(targetQueryKey, {
        ...current,
        liked: action === "like" ? active : current.liked,
        saved: action === "favorite" ? active : current.saved,
        count: action === "like" ? Math.max(0, current.count + (active ? 1 : -1)) : current.count,
      });
      return { previous, action, queryKey: targetQueryKey, userId };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(context.queryKey, context.previous);
      else if (context) queryClient.removeQueries({ queryKey: context.queryKey, exact: true });
    },
    onSuccess: (next, variables, context) => {
      const targetQueryKey = context?.queryKey ?? variables.queryKey;
      queryClient.setQueryData(targetQueryKey, next);
      const activeUserId = queryClient.getQueryData<{ id: number } | null>(["/api/user"])?.id;
      if (context?.action === "favorite" && activeUserId === context.userId) onFavoriteChange?.();
    },
    onSettled: () => { requestLock.current = false; },
  });

  const current = data ?? { count: 0, liked: false, saved: false };
  const visitSignIn = () => {
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    setLocation(`/auth?next=${encodeURIComponent(returnTo)}`);
  };
  const toggle = (action: "like" | "favorite") => {
    if (requestLock.current || mutation.isPending) return;
    if (!user) {
      visitSignIn();
      return;
    }
    const active = action === "like" ? !current.liked : !current.saved;
    mutation.mutate({ action, active, queryKey, userId: user.id, kind, id });
  };
  const blocked = mutation.isPending || isLoading;
  const label = title ? ` ${title}` : "";

  return (
    <div className={`flex items-center gap-2 ${compact ? "text-xs" : "text-sm"}`} role="group" aria-label="Community actions">
      <button
        type="button"
        disabled={blocked}
        aria-pressed={current.liked}
        aria-label={`${current.liked ? "Unlike" : "Like"}${label}; ${current.count} likes`}
        onClick={() => toggle("like")}
        className={`inline-flex min-h-11 items-center gap-1.5 rounded-sm border px-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-60 ${current.liked ? "border-primary/60 bg-primary/10 text-primary" : "border-border text-foreground/80 hover:border-primary/50 hover:text-primary"}`}
      >
        {mutation.isPending ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Heart aria-hidden="true" className={`h-4 w-4 ${current.liked ? "fill-current" : ""}`} />}
        <span>{current.count}</span>
      </button>
      <button
        type="button"
        disabled={blocked}
        aria-pressed={current.saved}
        aria-label={`${current.saved ? "Remove from" : "Save to"} favorites${label}`}
        onClick={() => toggle("favorite")}
        className={`inline-flex min-h-11 items-center gap-1.5 rounded-sm border px-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-60 ${current.saved ? "border-accent/60 bg-accent/10 text-accent" : "border-border text-foreground/80 hover:border-accent/50 hover:text-accent"}`}
      >
        <Bookmark aria-hidden="true" className={`h-4 w-4 ${current.saved ? "fill-current" : ""}`} />
        {!compact && <span>{current.saved ? "Saved" : "Save"}</span>}
      </button>
      {isError && <button type="button" className="min-h-11 text-xs text-muted-foreground underline" onClick={() => void refetch()}>Retry</button>}
      {!user && <button type="button" onClick={visitSignIn} className="min-h-11 text-xs text-muted-foreground underline underline-offset-4">Sign in to join in</button>}
      {mutation.isError && <p role="alert" className="basis-full text-xs text-destructive">Could not save this change. Your previous state has been restored. Try again.</p>}
      <span className="sr-only" aria-live="polite">{mutation.isPending ? "Saving community action" : ""}</span>
    </div>
  );
}
