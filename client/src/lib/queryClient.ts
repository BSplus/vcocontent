import { QueryClient, QueryFunction } from "@tanstack/react-query";

// Hilfsfunktion zum Überprüfen und Werfen von API-Fehlern
async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

// API-Anfragefunktion mit verbesserter Fehlerbehandlung
export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

// Konfiguration für Authentifizierungsverhalten
type UnauthorizedBehavior = "returnNull" | "throw";

// Query-Funktion mit Auth-Fehlerbehandlung
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    try {
      const res = await fetch(queryKey[0] as string, {
        credentials: "include",
      });

      if (res.status === 401) {
        if (unauthorizedBehavior === "returnNull") {
          return null;
        }
        throw new Error("Unauthorized");
      }

      await throwIfResNotOk(res);
      return await res.json();
    } catch (error) {
      console.error("Query error:", error);
      throw error;
    }
  };

// Query Client Konfiguration
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 0, // Reduziert auf 0 für sofortige Aktualisierungen
      retry: 1, // Ein Wiederholungsversuch für fehlgeschlagene Anfragen
      cacheTime: 5 * 60 * 1000, // 5 Minuten Cache
    },
    mutations: {
      retry: 1,
    },
  },
});