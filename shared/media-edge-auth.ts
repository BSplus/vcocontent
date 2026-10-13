export const previewKeyPattern = /^thumb-[0-9a-f-]{36}\.webp$/;
export const previewDigestPattern = /^[0-9a-f]{64}$/;
export function edgeAuthMessage(key: string, version: string, timestamp: string) {
  return `vco-preview-v1\n${key}\n${version}\n${timestamp}`;
}
