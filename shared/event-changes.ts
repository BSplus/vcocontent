/** Compare parsed event fields, including Date values, without mutating input. */
export function effectiveEventChanges<T extends object>(changes: T, before: object): T {
  return Object.fromEntries(Object.entries(changes).filter(([key, value]) => {
    if (value === undefined) return false;
    const previous = (before as Record<string, unknown>)[key];
    if (key === "date") return +new Date(value) !== +new Date(previous as string);
    return value !== previous;
  })) as T;
}
