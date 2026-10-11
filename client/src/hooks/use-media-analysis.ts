import { useQuery } from "@tanstack/react-query";

export type AnalysisState = {
  status: "not_requested" | "queued" | "running" | "completed" | "failed";
  generatedTags?: string[] | null; tags?: string[] | null; category?: string | null;
  error?: string | null; attempts?: number;
  generation?: number;
  identification?: MediaIdentification[];
  identificationManual?: boolean;
  recognitionSession?: string | null;
  caption?: string | null;
  captionSource?: string;
  matchStatus?: string | null;
};
export type MediaIdentification = {
  number: string;
  team: string;
  drivers: string;
  vehicle: string;
  manufacturer: string;
  racingClass: string;
  discipline: string;
  source: "reference" | "visual" | "manual";
};
export const analysisPending = (status?: string) => status === "queued" || status === "running";

export function useMediaAnalysis(id: number, enabled: boolean) {
  return useQuery<AnalysisState>({
    queryKey: [`/api/media/${id}/analysis`], enabled,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: query => analysisPending(query.state.data?.status) ? 4000 : false,
  });
}

export async function requestAnalysis(id: number, options: boolean | { retry?: boolean; reanalyse?: boolean } = false): Promise<AnalysisState> {
  const body = typeof options === "boolean" ? { retry: options } : options;
  const response = await fetch(`/api/media/${id}/analyze`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("Analysis could not be requested. Please try again.");
  return response.json();
}
