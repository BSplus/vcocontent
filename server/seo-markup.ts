export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

export function summary(value: string, max = 160): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

/** Only independently protected previews; never object-store URLs or originals. */
export function publicThumbnail(item: { id: number; thumbnail: string }): string | undefined {
  const candidate = item.thumbnail?.startsWith("data:") ? `/api/media/legacy/${item.id}/thumbnail` : item.thumbnail;
  return /^\/api\/media\/(?:files\/thumb-[0-9a-f-]{36}\.webp|legacy\/[1-9]\d*\/thumbnail)$/.test(candidate || "")
    ? candidate : undefined;
}

export function jsonLd(value: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(value)
    .replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")}</script>`;
}

export function dateLabel(value: Date | string | undefined): string {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

export function eventLinks(items: { id: number; title: string; date: Date | string }[]): string {
  return `<ul>${items.map(item => `<li><a href="/events/${item.id}">${escapeHtml(item.title)}</a> ${escapeHtml(dateLabel(item.date))}</li>`).join("")}</ul>`;
}

export function imageLinks(items: { id: number; thumbnail: string; caption: string | null; photographer: string | null }[], eventTitle: string): string {
  return `<div class="public-preview-grid">${items.map(item => {
    const thumbnail = publicThumbnail(item);
    const label = item.caption || `${eventTitle} photo`;
    return thumbnail ? `<figure><a href="/media/${item.id}"><img src="${escapeHtml(thumbnail)}" alt="${escapeHtml(label)}" loading="lazy" width="480" height="320"><figcaption>${escapeHtml(label)}</figcaption></a>${item.photographer ? `<p>Photographer: ${escapeHtml(item.photographer)}</p>` : ""}</figure>` : "";
  }).join("")}</div>`;
}
