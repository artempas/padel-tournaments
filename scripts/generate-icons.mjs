/**
 * Rasterises src/app/icon.svg into the bitmap icons browsers still need —
 * favicon, the iOS home-screen icon and the ones the web app manifest points at.
 *
 *   npm run icons
 *
 * `icon.svg` is the source of truth — edit it, then re-run this. sharp is not a
 * declared dependency: it arrives with Next. Install it if that ever changes.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const appDir = new URL('../src/app/', import.meta.url);
const publicDir = new URL('../public/', import.meta.url);
const svg = await readFile(fileURLToPath(new URL('icon.svg', appDir)));

async function png(size) {
  return sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
}

// iOS home-screen icon. No transparency and no rounding — iOS masks it itself.
await writeFile(fileURLToPath(new URL('apple-icon.png', appDir)), await png(180));

/**
 * A .ico may simply wrap a PNG, so build the 22-byte header by hand rather
 * than pulling in an encoder. Kept for old browsers and crawlers that ask
 * for /favicon.ico regardless of the declared SVG icon.
 */
const icoPng = await png(32);
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // one image
header.writeUInt8(32, 6); // width
header.writeUInt8(32, 7); // height
header.writeUInt8(0, 8); // palette size (0 = none)
header.writeUInt8(0, 9); // reserved
header.writeUInt16LE(1, 10); // colour planes
header.writeUInt16LE(32, 12); // bits per pixel
header.writeUInt32LE(icoPng.length, 14);
header.writeUInt32LE(22, 18); // offset of the image data

await writeFile(
  fileURLToPath(new URL('favicon.ico', appDir)),
  Buffer.concat([header, icoPng]),
);

/**
 * Icons for the web app manifest. They live in `public/` because the manifest
 * points at them by URL — the `src/app` icon conventions only cover the tags
 * Next injects itself.
 */
await mkdir(fileURLToPath(publicDir), { recursive: true });
await writeFile(fileURLToPath(new URL('icon-192.png', publicDir)), await png(192));
await writeFile(fileURLToPath(new URL('icon-512.png', publicDir)), await png(512));

/**
 * A maskable icon is cropped to whatever shape the launcher likes — a circle on
 * most Androids — so everything important must sit inside the middle 80%.
 * Scaling the artwork to 80% and padding with the background colour does that.
 */
const MASKABLE = 512;
const inner = Math.round(MASKABLE * 0.8);
const pad = (MASKABLE - inner) / 2;
await writeFile(
  fileURLToPath(new URL('icon-maskable-512.png', publicDir)),
  await sharp(await png(inner))
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: '#070c16' })
    .png({ compressionLevel: 9 })
    .toBuffer(),
);

console.log(
  'Wrote apple-icon.png (180px), favicon.ico (32px) and manifest icons ' +
    '(192px, 512px, 512px maskable)',
);
