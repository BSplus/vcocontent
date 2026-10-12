import React from "react";
import { cn } from "@/lib/utils";

/** Render only server-confirmed (or locally computed) page bounds. */
export default function PageStatus({ page, totalPages, className }: {
  page: number; totalPages?: number; className?: string;
}) {
  if (totalPages === undefined) return null;
  return <span className={cn("whitespace-nowrap text-sm text-muted-foreground", className)} aria-live="polite">
    PAGE {Math.min(page, totalPages)} OF {totalPages}
  </span>;
}
