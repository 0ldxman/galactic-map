/**
 * Getting a picture into the map.
 *
 * A reference image lives inside the map document as a data URI, which is what
 * makes it survive a reload, reach co-editors over the same op channel as
 * everything else, and ride along in the JSON export — no upload endpoint, no
 * second store, nothing to garbage-collect. The price is that the bytes are the
 * map's bytes, so a 6 MB screenshot dropped in raw would be a 8 MB map saved
 * every few seconds.
 *
 * So nothing is ever stored as dropped. Every image is decoded, scaled down to
 * a sane working size and re-encoded, and if the result is still too heavy the
 * process repeats harder. A screenshot you are tracing over does not need to be
 * larger than the screen you are tracing on.
 */

/** Longest side kept, in pixels. Plenty to align systems against. */
const MAX_SIDE = 2048;
/** Give up adding detail past this many bytes of data URI. */
const MAX_BYTES = 2_500_000;

export interface ImportedImage {
  src: string;
  /** pixel size of the stored bitmap (not of the original file) */
  w: number;
  h: number;
  /** length of the data URI, for the "this map is getting heavy" warning */
  bytes: number;
}

export const MAX_IMAGE_BYTES = MAX_BYTES;

/** The encoders worth trying, best first. Falls back when one is unsupported. */
function pickType(canvas: HTMLCanvasElement): string {
  for (const type of ['image/webp', 'image/jpeg']) {
    if (canvas.toDataURL(type).startsWith(`data:${type}`)) return type;
  }
  return 'image/png';
}

function decode(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file is not an image the browser can read.'));
    };
    img.src = url;
  });
}

/**
 * Read an image file (or a pasted blob) into a bounded data URI.
 *
 * Transparency is preserved when WebP is available; the JPEG fallback flattens
 * it onto black, which is the map's own background, so a PNG with a soft edge
 * still looks right on top of the map.
 */
export async function importImage(file: Blob): Promise<ImportedImage> {
  const img = await decode(file);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH) throw new Error('That image has no dimensions.');

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const type = pickType(canvas);

  let side = MAX_SIDE;
  let quality = 0.82;
  let out = '';
  let w = srcW;
  let h = srcH;

  // Shrink until it fits. Two quality steps first (cheap, keeps the pixels),
  // then halve the resolution, which always wins eventually.
  for (let attempt = 0; attempt < 6; attempt++) {
    const k = Math.min(1, side / Math.max(srcW, srcH));
    w = Math.max(1, Math.round(srcW * k));
    h = Math.max(1, Math.round(srcH * k));
    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    if (type === 'image/jpeg') {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    out = canvas.toDataURL(type, quality);
    if (out.length <= MAX_BYTES) break;
    if (quality > 0.6) quality -= 0.12;
    else side = Math.round(side * 0.7);
  }

  return { src: out, w, h, bytes: out.length };
}

/** Every image file in a drop or a paste, in the order the browser reports. */
export function imageFilesFrom(
  data: DataTransfer | null | undefined
): File[] {
  if (!data) return [];
  const out: File[] = [];
  for (const item of Array.from(data.files ?? [])) {
    if (item.type.startsWith('image/')) out.push(item);
  }
  if (out.length === 0) {
    for (const item of Array.from(data.items ?? [])) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) out.push(f);
      }
    }
  }
  return out;
}
