import { useEffect, useRef, useState } from "react";
import { getQueryFn, queryClient } from "@/lib/queryClient";
import type { User } from "@shared/schema";

export type ConfirmationStatus = "none" | "confirming" | "success" | "invalid" | "unavailable";
export type ConfirmationSessionStatus = "loading" | "ready" | "error";

const verificationFragment = () => window.location.hash.match(/(?:^#|&)verify=([^&]*)/);

export function useEmailConfirmation() {
  // Block ordinary auth redirects from the very first render, even if /api/user is cached.
  const [status, setStatus] = useState<ConfirmationStatus>(() => verificationFragment() ? "confirming" : "none");
  const [sessionStatus, setSessionStatus] = useState<ConfirmationSessionStatus>("loading");
  const [showLogin, setShowLogin] = useState(false);
  const generation = useRef(0);
  const alive = useRef(true);

  const refreshSession = async (run = generation.current) => {
    setSessionStatus("loading");
    try {
      // Cancel an initial, possibly stale user lookup before reading the established session.
      await queryClient.cancelQueries({ queryKey: ["/api/user"] });
      if (!alive.current || generation.current !== run) return;
      await queryClient.fetchQuery<User | null>({
        queryKey: ["/api/user"],
        queryFn: getQueryFn({ on401: "returnNull" }),
        staleTime: 0,
        retry: false,
      });
      if (alive.current && generation.current === run) setSessionStatus("ready");
    } catch {
      if (alive.current && generation.current === run) setSessionStatus("error");
    }
  };

  useEffect(() => {
    alive.current = true;
    const consume = async () => {
      const match = verificationFragment();
      if (!match) return;
      const run = ++generation.current;
      // Never leave a token in the address bar/history or pass it through a GET request.
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
      setStatus("confirming");
      setShowLogin(false);
      setSessionStatus("loading");
      const current = () => alive.current && generation.current === run;
      let token: string;
      try {
        token = decodeURIComponent(match[1]);
        if (!/^[0-9a-f]{64}$/.test(token)) throw new Error();
      } catch {
        setStatus("invalid");
        void refreshSession(run);
        return;
      }
      try {
        // Single-use redemption must not use the generic automatic retries or error logging.
        const response = await fetch("/api/email-verification/confirm", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ token }),
          signal: AbortSignal.timeout(15000),
        });
        const result = await response.json().catch(() => null);
        if (!current()) return;
        setStatus(response.ok && result?.verified === true ? "success" :
          response.status === 400 ? "invalid" : "unavailable");
      } catch {
        if (!current()) return;
        setStatus("unavailable");
      }
      if (current()) void refreshSession(run);
    };
    void consume();
    window.addEventListener("hashchange", consume);
    return () => {
      alive.current = false;
      window.removeEventListener("hashchange", consume);
    };
  }, []);

  return {
    status, sessionStatus, showLogin,
    openLogin: () => setShowLogin(true),
    finishLogin: () => setStatus("none"),
    refreshSession: () => void refreshSession(),
  };
}
