import sharp from 'sharp';

interface ProcessedImage {
  original: Buffer;
  optimized: Buffer;
  thumbnail: Buffer;
  webp: Buffer;
  width: number;
  height: number;
  format: string;
}

export async function processImage(imageBuffer: Buffer): Promise<ProcessedImage> {
  try {
    // Get image metadata
    const metadata = await sharp(imageBuffer).metadata();
    const originalWidth = metadata.width || 0;
    const originalHeight = metadata.height || 0;

    // Calculate dimensions while maintaining aspect ratio
    const MAX_WIDTH = 1920;
    const MAX_THUMBNAIL_WIDTH = 400;
    
    let resizeWidth = originalWidth;
    let resizeHeight = originalHeight;
    
    if (originalWidth > MAX_WIDTH) {
      resizeWidth = MAX_WIDTH;
      resizeHeight = Math.round((originalHeight * MAX_WIDTH) / originalWidth);
    }

    // Process original image
    const optimized = await sharp(imageBuffer)
      .resize(resizeWidth, resizeHeight, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({
        quality: 80,
        progressive: true
      })
      .toBuffer();

    // Create WebP version
    const webp = await sharp(imageBuffer)
      .resize(resizeWidth, resizeHeight, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({
        quality: 80
      })
      .toBuffer();

    // Generate thumbnail
    const thumbnail = await sharp(imageBuffer)
      .resize(MAX_THUMBNAIL_WIDTH, undefined, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({
        quality: 70
      })
      .toBuffer();

    return {
      original: imageBuffer,
      optimized,
      thumbnail,
      webp,
      width: resizeWidth,
      height: resizeHeight,
      format: metadata.format || 'jpeg'
    };
  } catch (error) {
    console.error('Image processing error:', error);
    throw new Error('Failed to process image');
  }
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export function getImageDimensions(buffer: Buffer): Promise<{ width: number; height: number }> {
  return sharp(buffer).metadata().then(metadata => ({
    width: metadata.width || 0,
    height: metadata.height || 0
  }));
}
