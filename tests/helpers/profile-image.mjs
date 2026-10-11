import sharp from "sharp";

// Valid JPEG comment segments give fixtures exact source sizes without changing
// image pixels or relying on a decoder accepting trailing junk.
export async function profileImageBytes(size, background = "#124578") {
  const jpeg = await sharp({ create: { width: 600, height: 400, channels: 3, background } }).jpeg().toBuffer();
  let remaining = size - jpeg.length;
  if (remaining < 4) throw new Error("Fixture size must allow a JPEG comment");
  const comments = [];
  while (remaining) {
    let length = Math.min(remaining, 65537);
    if (remaining - length > 0 && remaining - length < 4) length -= 4;
    const segment = Buffer.alloc(length);
    segment[0] = 0xff; segment[1] = 0xfe;
    segment.writeUInt16BE(length - 2, 2);
    comments.push(segment);
    remaining -= length;
  }
  return Buffer.concat([jpeg.subarray(0, -2), ...comments, jpeg.subarray(-2)]);
}
