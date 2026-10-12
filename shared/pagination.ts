/** A confirmed count, including a single empty page. Never infer it from page length. */
export interface PageMetadata {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}
export type PageEnvelope<T> = PageMetadata & { items: T[] };

export function pageMetadata(total: number, requestedPage: number, pageSize: number): PageMetadata {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  return { page, pageSize, total, totalPages, hasMore: page < totalPages };
}
