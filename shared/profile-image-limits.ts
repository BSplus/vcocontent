// Decimal MB: the limit applies to each original file, before normalization.
export const PROFILE_IMAGE_SOURCE_BYTES = 3_000_000;
export const PROFILE_IMAGE_SIZE_MESSAGE = "Each profile photo or cover image must be no larger than 3 MB (3,000,000 bytes).";
export const PROFILE_IMAGE_DATA_URL_LENGTH = 4 * Math.ceil(PROFILE_IMAGE_SOURCE_BYTES / 3) + "data:image/jpeg;base64,".length;
// Two maximum Base64 images, their prefixes, and bounded profile metadata.
export const PROFILE_JSON_BYTES = 2 * PROFILE_IMAGE_DATA_URL_LENGTH + 64 * 1024;
