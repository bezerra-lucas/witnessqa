/** Screenshot codecs and file reuse. Only already-masked pixels enter this module. */
import sharp from 'sharp';
import { createHash, randomUUID } from 'node:crypto';
import { constants, copyFileSync, lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { safeEvidencePath } from './safe-evidence-path.mjs';

// Runs already retain the previous encoded frame. Keep libvips' separate cache
// small so screenshot compression does not hold tens of MiB between scenarios.
sharp.cache({ memory: 8, files: 0, items: 16 });

export const imageDigest = bytes => createHash('sha256').update(bytes).digest('hex');
export const imageType = name => ({ '.png': 'image/png', '.webp': 'image/webp' })[extname(name).toLowerCase()] ?? null;

export function safeImagePath(directory, name) {
  return typeof name === 'string' && imageType(name) ? safeEvidencePath(directory, name) : null;
}

// Bound native encoding memory independently of the number of browser slots.
// Queued inputs are already privacy-masked; failures cannot poison the queue.
let encodingTail = Promise.resolve();
export async function encodeScreenshot(png, format = 'webp') {
  // An explicit PNG requirement belongs to the existing CI contract. Store one
  // format, never a WebP plus an original PNG. Ordinary runs use lossless WebP.
  if (format === 'png') return png;
  if (format !== 'webp') throw new Error('Unsupported screenshot format');
  const encoded = encodingTail.then(() => sharp(png).webp({ lossless: true, effort: 1 }).toBuffer());
  encodingTail = encoded.then(() => undefined, () => undefined);
  return encoded;
}

/** Reflinks share storage where supported; every evidence file remains independent. */
export function writeImage(path, bytes, identicalPath) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    let copied = false;
    if (identicalPath) {
      try {
        const stat = lstatSync(identicalPath);
        if (stat.isFile() && !stat.isSymbolicLink() && readFileSync(identicalPath).equals(bytes)) {
          copyFileSync(identicalPath, temporary, constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL);
          copied = true;
        }
      } catch { /* missing source or another filesystem: write the verified bytes */ }
    }
    if (!copied) writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export async function decodeScreenshot(bytes) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Header-only dimensions keep the synchronous report builder from decoding pixels. */
export function imageDimensions(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 25 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = bytes.toString('ascii', 12, 16);
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X' && bytes.length >= 30) {
      return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
    }
  }
  return { width: null, height: null };
}
