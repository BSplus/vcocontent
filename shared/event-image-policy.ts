/** New official event metadata images, independent of gallery upload limits. */
export const eventImagePolicy = {
  bytes: 1024 * 1024,
  pixels: 40_000_000,
  accept: "image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif",
  help: "JPEG, PNG, WebP or GIF · maximum 1 MiB and 40 megapixels (all frames combined).",
};
