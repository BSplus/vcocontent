import { useQuery } from "@tanstack/react-query";

export type AnalysisState = {
  status: "not_requested" | "queued" | "running" | "completed" | "failed";
  generatedTags?: string[] | null; tags?: string[] | null; category?: string | null;
  error?: string | null; attempts?: number;
};
export const analysisPending = (status?: string) => status === "queued" || status === "running";

export function useMediaAnalysis(id: number, enabled: boolean) {
  return useQuery<AnalysisState>({
    queryKey: [`/api/media/${id}/analysis`], enabled,
    refetchInterval: query => analysisPending(query.state.data?.status) ? 4000 : false,
  });
}

export async function requestAnalysis(id: number, retry = false): Promise<AnalysisState> {
  const response = await fetch(`/api/media/${id}/analyze`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ retry }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Analysis could not be requested");
  return data;
}
