import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    console.error(`API Error: ${res.status} - ${text}`);
    throw new Error(text);
  }
}

async function fetchWithRetry(
  url: string, 
  options: RequestInit, 
  retries = 3, 
  delay = 500
): Promise<Response> {
  try {
    const res = await fetch(url, options);
    
    // If it's a 502 or 504 (gateway errors), retry
    if ((res.status === 502 || res.status === 504) && retries > 0) {
      console.log(`Received ${res.status} from server. Retrying in ${delay}ms... (${retries} retries left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retries - 1, delay * 1.5); // Exponential backoff
    }
    
    return res;
  } catch (error) {
    // Network errors
    if (retries > 0) {
      console.log(`Network error. Retrying in ${delay}ms... (${retries} retries left)`, error);
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retries - 1, delay * 1.5);
    }
    throw error;
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  console.log(`Making ${method} request to ${url}`, { data });
  
  const options: RequestInit = {
    method,
    headers: data ? { 
      "Content-Type": "application/json",
      "Accept": "application/json"
    } : {
      "Accept": "application/json"
    },
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",  // Always include credentials
  };
  
  const res = await fetchWithRetry(url, options);
  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    console.log('Making query request:', { queryKey });
    
    const options: RequestInit = {
      credentials: "include",  // Always include credentials
      headers: {
        "Accept": "application/json"
      }
    };
    
    // Use the same retry logic as apiRequest
    const res = await fetchWithRetry(queryKey[0] as string, options);

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      console.log('Received 401, returning null as configured');
      return null;
    }

    await throwIfResNotOk(res);
    const data = await res.json();
    console.log('Query response:', { queryKey, data });
    return data;
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: 3, // Allow up to 3 retries for queries
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000), // exponential backoff with max of 30 seconds
    },
    mutations: {
      retry: 2, // Allow up to 2 retries for mutations
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 15000), // exponential backoff with max of 15 seconds
    },
  },
});