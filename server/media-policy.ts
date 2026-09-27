const mib = 1024 * 1024;
function positiveInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${name} must be a positive integer`);
  return number;
}

export const mediaPolicy = {
  imageBytes: positiveInt("MEDIA_IMAGE_MIB", 5) * mib,
  videoBytes: positiveInt("MEDIA_VIDEO_MIB", 50) * mib,
  eventBytes: positiveInt("MEDIA_EVENT_MIB", 2048) * mib,
  creatorBytes: positiveInt("MEDIA_CREATOR_MIB", 10240) * mib,
  eventCount: positiveInt("MEDIA_EVENT_COUNT", 1000),
  creatorCount: positiveInt("MEDIA_CREATOR_COUNT", 5000),
  maxPixels: positiveInt("MEDIA_IMAGE_MEGAPIXELS", 40) * 1_000_000,
  displayEdge: positiveInt("MEDIA_DISPLAY_EDGE", 2560),
  thumbnailEdge: positiveInt("MEDIA_THUMB_EDGE", 640),
  zipCount: 100,
  zipBytes: 100 * mib,
};

export class MediaLimitError extends Error {}