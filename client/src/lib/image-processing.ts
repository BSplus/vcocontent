interface ProcessedImage {
  original: Blob;
  optimized: Blob;
  thumbnail: Blob;
  webp: Blob;
  width: number;
  height: number;
  format: string;
}

export async function processImage(image: Blob): Promise<ProcessedImage> {
  const bitmap = await createImageBitmap(image);
  try {
    const scale = Math.min(1, 1920 / bitmap.width);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const optimizedCanvas = document.createElement('canvas');
    optimizedCanvas.width = width;
    optimizedCanvas.height = height;
    const optimizedContext = optimizedCanvas.getContext('2d');
    if (!optimizedContext) throw new Error('Unable to process this image in your browser.');
    optimizedContext.drawImage(bitmap, 0, 0, width, height);

    const thumbnailScale = Math.min(1, 400 / bitmap.width);
    const thumbnailCanvas = document.createElement('canvas');
    thumbnailCanvas.width = Math.max(1, Math.round(bitmap.width * thumbnailScale));
    thumbnailCanvas.height = Math.max(1, Math.round(bitmap.height * thumbnailScale));
    const thumbnailContext = thumbnailCanvas.getContext('2d');
    if (!thumbnailContext) throw new Error('Unable to create an image thumbnail in your browser.');
    thumbnailContext.drawImage(bitmap, 0, 0, thumbnailCanvas.width, thumbnailCanvas.height);

    const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image conversion failed.')), type, quality);
      });
    const [optimized, thumbnail, webp] = await Promise.all([
      toBlob(optimizedCanvas, 'image/jpeg', 0.8),
      toBlob(thumbnailCanvas, 'image/jpeg', 0.7),
      toBlob(optimizedCanvas, 'image/webp', 0.8),
    ]);

    return { original: image, optimized, thumbnail, webp, width, height, format: 'jpeg' };
  } finally {
    bitmap.close();
  }
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export async function getImageDimensions(image: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(image);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}
