import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";

const root = process.cwd();
const outputDir = path.join(root, "client/public/brand");
const sourceLogo = path.join(root, "attached_assets/VCO_2021_reg_White_Trans.png");
const colors = {
  background: "#11151C",
  raised: "#171D25",
  grid: "#27313C",
  white: "#E6E9EB",
  muted: "#ACB6C0",
  blue: "#1C92FF",
};

const fontFiles = [
  [
    path.join(root, "node_modules/@fontsource/big-shoulders-display/files/big-shoulders-display-latin-800-normal.woff"),
    "Big Shoulders Display",
  ],
  [
    path.join(root, "node_modules/@fontsource/ibm-plex-sans-condensed/files/ibm-plex-sans-condensed-latin-500-normal.woff"),
    "IBM Plex Sans Condensed",
  ],
  [
    path.join(root, "node_modules/@fontsource/ibm-plex-sans-condensed/files/ibm-plex-sans-condensed-latin-700-normal.woff"),
    "IBM Plex Sans Condensed",
  ],
];

for (const [fontPath, family] of fontFiles) {
  if (!GlobalFonts.registerFromPath(fontPath, family)) {
    throw new Error(`Could not register the required VCO brand font: ${family}`);
  }
}

await mkdir(outputDir, { recursive: true });

// Remove the source artwork's transparent whitespace while leaving a small,
// predictable 2.5% clear margin around the actual wordmark.
const trimmedLogo = await sharp(sourceLogo)
  .ensureAlpha()
  .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
  .png()
  .toBuffer();
const logoMeta = await sharp(trimmedLogo).metadata();
const logoMargin = Math.max(4, Math.round(Math.max(logoMeta.width, logoMeta.height) * 0.025));
const logoPng = await sharp(trimmedLogo)
  .extend({
    top: logoMargin,
    bottom: logoMargin,
    left: logoMargin,
    right: logoMargin,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toBuffer();
await writeFile(path.join(outputDir, "vco-logo-white.png"), logoPng);
await sharp(logoPng)
  .tint("#11151C")
  .png()
  .toFile(path.join(outputDir, "vco-logo-dark.png"));
const logoImage = await loadImage(logoPng);
const tightLogoImage = await loadImage(trimmedLogo);

function drawLogoFit(ctx, x, y, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / logoImage.width, maxHeight / logoImage.height);
  const width = logoImage.width * scale;
  const height = logoImage.height * scale;
  ctx.drawImage(logoImage, x + (maxWidth - width) / 2, y + (maxHeight - height) / 2, width, height);
}

function drawWordmarkIcon(size, background = colors.background) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, size, size);

  // Use the alpha-trimmed source, rather than its padded public lockup, so the
  // official wordmark occupies as much of each tiny dark-backed icon as fits.
  const scale = Math.min((size - 2) / tightLogoImage.width, (size * 0.42) / tightLogoImage.height);
  const width = tightLogoImage.width * scale;
  const height = tightLogoImage.height * scale;
  ctx.drawImage(tightLogoImage, (size - width) / 2, (size - height) / 2, width, height);
  return canvas;
}

for (const size of [16, 32, 48]) {
  await sharp(drawWordmarkIcon(size).toBuffer("image/png"))
    .png()
    .toFile(path.join(outputDir, `vco-icon-${size}.png`));
}

async function makeIco(entries, destination) {
  const header = Buffer.alloc(6 + entries.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const payloads = [];
  let offset = header.length;
  for (let i = 0; i < entries.length; i += 1) {
    const { size, buffer } = entries[i];
    const entry = 6 + i * 16;
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(buffer.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    payloads.push(buffer);
    offset += buffer.length;
  }
  await writeFile(destination, Buffer.concat([header, ...payloads]));
}

const faviconEntries = [];
for (const size of [16, 32, 48]) {
  const buffer = await sharp(drawWordmarkIcon(size).toBuffer("image/png")).png().toBuffer();
  faviconEntries.push({ size, buffer });
}
await makeIco(faviconEntries, path.join(outputDir, "favicon.ico"));

for (const size of [180, 192, 512]) {
  const canvas = drawWordmarkIcon(size);
  await sharp(canvas.toBuffer("image/png"))
    .png()
    .toFile(path.join(outputDir, size === 180 ? "apple-touch-icon.png" : `icon-${size}.png`));
}

function drawSocialCard() {
  const width = 1200;
  const height = 630;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, width, height);

  // Quiet technical grid and clipped race-stripe detail stay peripheral.
  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 1;
  for (let x = 88; x < width - 88; x += 56) {
    ctx.beginPath();
    ctx.moveTo(x, 64);
    ctx.lineTo(x, height - 64);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.42;
  ctx.fillStyle = colors.raised;
  ctx.beginPath();
  ctx.moveTo(938, 0);
  ctx.lineTo(width, 0);
  ctx.lineTo(width, 630);
  ctx.lineTo(1010, 630);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  ctx.globalAlpha = 0.13;
  ctx.strokeStyle = colors.blue;
  ctx.lineWidth = 2;
  for (let i = 0; i < 8; i += 1) {
    ctx.beginPath();
    ctx.moveTo(860 + i * 31, 95);
    ctx.lineTo(1045 + i * 31, 95);
    ctx.stroke();
  }
  ctx.restore();

  // Every identifying element is centered inside the 630px square crop
  // (x=285..915), with clear breathing room from its horizontal edges.
  drawLogoFit(ctx, 405, 70, 390, 92);
  ctx.fillStyle = colors.blue;
  ctx.fillRect(570, 184, 60, 4);

  ctx.font = '800 86px "Big Shoulders Display"';
  ctx.letterSpacing = "-0.5px";
  ctx.fillStyle = colors.white;
  ctx.textAlign = "center";
  ctx.fillText("VCO MEDIA", 600, 294);
  ctx.fillText("DATABASE", 600, 390);

  ctx.fillStyle = colors.muted;
  ctx.font = '500 20px "IBM Plex Sans Condensed"';
  ctx.letterSpacing = "0px";
  ctx.fillText("THE HOME OF VCO RACING MEDIA", 600, 454);

  // Compact center marker remains within the square-safe area.
  ctx.fillStyle = colors.blue;
  ctx.fillRect(438, 491, 324, 2);
  ctx.fillStyle = colors.muted;
  ctx.font = '700 13px "IBM Plex Sans Condensed"';
  ctx.letterSpacing = "1.4px";
  ctx.fillText("RACING  /  ORGANIZED", 600, 526);
  ctx.textAlign = "start";

  return canvas;
}

await sharp(drawSocialCard().toBuffer("image/png"))
  .jpeg({ quality: 91, mozjpeg: true })
  .toFile(path.join(outputDir, "vco-social.jpg"));

console.log(`VCO branding assets generated in ${path.relative(root, outputDir)}`);
