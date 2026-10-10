import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { AlertCircle, Link2, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { GalleryAssociation, OfficialEventOption } from "@/types/creator-association";

export const creatorOfficialEventsKey = ["/api/creator/official-events"] as const;
export const creatorAssociationsKey = ["/api/creator/event-associations"] as const;

export function invalidateCommunityGalleryQueries(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: query => {
      const key = query.queryKey[0];
      return typeof key === "string" && /^\/api\/events\/\d+\/community-galleries$/.test(key);
    },
  });
}

interface CreatorGalleryAssociationProps {
  galleryId: number;
}

export default function CreatorGalleryAssociation({ galleryId }: CreatorGalleryAssociationProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: officialEvents, isLoading: eventsLoading, isError: eventsError, refetch: retryEvents } =
    useQuery<OfficialEventOption[]>({
      queryKey: creatorOfficialEventsKey,
      staleTime: 60_000,
    });
  const {
    data: associations,
    isLoading: associationsLoading,
    isError: associationsError,
    refetch: retryAssociations,
  } = useQuery<GalleryAssociation[]>({
      queryKey: [...creatorAssociationsKey, user?.id ?? "signed-out"],
      enabled: !!user,
    staleTime: 0,
  });

  const association = associations?.find(item => item.galleryId === galleryId);
  const selectedEventId = association?.officialEventId;
  const selectedValue = association?.unavailable
    ? `unavailable-${galleryId}`
    : selectedEventId == null ? "none" : String(selectedEventId);

  const saveAssociation = useMutation({
    retry: false,
    mutationFn: async (officialEventId: number | null) => {
      try {
        const response = await apiRequest("PUT", `/api/creator/events/${galleryId}/official-event`, { officialEventId });
        return await response.json() as { galleryId: number; officialEventId: number | null };
      } catch (error) {
        if (error instanceof Error) {
          let payload: { error?: string } | undefined;
          try {
            payload = JSON.parse(error.message) as { error?: string };
          } catch {
            payload = undefined;
          }
          if (payload?.error) throw new Error(payload.error);
        }
        throw error;
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: creatorAssociationsKey }),
        invalidateCommunityGalleryQueries(queryClient),
      ]);
    },
  });

  const reload = () => {
    if (eventsError) void retryEvents();
    if (associationsError) void retryAssociations();
  };
  const busy = eventsLoading || associationsLoading;

  return (
    <div className="basis-full border-t border-border pt-2">
      <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground sm:flex-row sm:items-center sm:gap-2">
        <span className="inline-flex items-center gap-1.5 text-foreground/75">
          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
          Official event association
        </span>
        {busy ? (
          <span className="flex h-9 items-center gap-2 text-xs" role="status">
            <span className="h-4 w-36 animate-pulse rounded bg-secondary" />
            <span className="sr-only">Loading association choices</span>
          </span>
        ) : eventsError || associationsError ? (
          <span className="flex flex-wrap items-center gap-2 text-destructive" role="alert">
            <AlertCircle className="h-4 w-4" />
            Association choices could not be loaded.
            <Button type="button" size="sm" variant="outline" className="min-h-9" onClick={reload}>Retry</Button>
          </span>
        ) : (
          <Select
            value={selectedValue}
            disabled={saveAssociation.isPending}
            onValueChange={value => {
              saveAssociation.mutate(value === "none" ? null : Number(value));
            }}
          >
            <SelectTrigger className="h-9 min-w-0 w-full sm:max-w-sm" aria-label="Associate gallery with an official event">
              <SelectValue placeholder="Not associated" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No association</SelectItem>
              {association?.unavailable && (
                <SelectItem value={`unavailable-${galleryId}`} disabled>
                  Linked event unavailable
                </SelectItem>
              )}
              {(officialEvents ?? []).map(event => (
                <SelectItem key={event.id} value={String(event.id)}>
                  {event.title} · {formatDate(event.date)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </label>
      {saveAssociation.isPending && <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground" role="status"><Loader2 className="h-3 w-3 animate-spin" />Saving association…</p>}
      {saveAssociation.isError && <p className="mt-1 text-xs text-destructive" role="alert">{saveAssociation.error.message || "The association could not be saved."}</p>}
      {!busy && !eventsError && !associationsError && officialEvents?.length === 0 && !association?.unavailable && (
        <p className="mt-1 text-xs text-muted-foreground">No eligible official events are available right now.</p>
      )}
      {association?.unavailable && (
        <p className="mt-1 text-xs text-muted-foreground">The linked event is unavailable. You can remove this link or choose another event.</p>
      )}
    </div>
  );
}
