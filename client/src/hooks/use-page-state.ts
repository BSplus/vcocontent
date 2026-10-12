import { useCallback, useState, type SetStateAction } from "react";

/** Scope changes reset synchronously, before a request for the new list is made. */
export function usePageState(scope: string | number) {
  const [state, setState] = useState({ scope, page: 1 });
  const page = state.scope === scope ? state.page : 1;
  const setPage = useCallback((value: SetStateAction<number>) => {
    setState(current => {
      const previous = current.scope === scope ? current.page : 1;
      const next = typeof value === "function" ? value(previous) : value;
      if (current.scope === scope && current.page === next) return current;
      return { scope, page: next };
    });
  }, [scope]);
  return [page, setPage] as const;
}
