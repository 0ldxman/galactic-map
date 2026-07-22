import { useEditor } from '../model/store';
import { liveCamera } from '../render/camera';
import { importImage, MAX_IMAGE_BYTES } from '../persistence/images';

/** How much of the viewport a freshly dropped reference spans, across. */
const DROP_SPAN = 0.6;

/**
 * Bring image files onto the map as reference layers.
 *
 * Placement is deliberate: the picture lands centred where it was dropped (or
 * in the middle of the view), sized to most of the viewport, and half
 * transparent — you are about to draw on top of it, and a fully opaque
 * screenshot would hide the map you are matching it against.
 *
 * Returns a message when something went wrong, or null on success. The caller
 * decides where to show it; this has no opinion about UI.
 */
export async function addImageFiles(
  files: readonly File[] | readonly Blob[],
  at?: { x: number; y: number }
): Promise<string | null> {
  const cam = liveCamera;
  const centre = at ?? { x: cam.x, y: cam.y };
  const spanW = (cam.viewW / cam.zoom) * DROP_SPAN;
  let placed = 0;
  let heavy = false;

  for (const file of files) {
    try {
      const img = await importImage(file);
      const k = spanW / img.w;
      const w = img.w * k;
      const h = img.h * k;
      // Stagger multiples so a batch doesn't land exactly on top of itself.
      const off = placed * (w * 0.06);
      useEditor.getState().addReference({
        name:
          ('name' in file && (file as File).name) ||
          `Reference ${Object.keys(useEditor.getState().map.references).length + 1}`,
        src: img.src,
        x: centre.x - w / 2 + off,
        y: centre.y - h / 2 + off,
        w,
        h,
        opacity: 0.6,
        layer: 'below',
      });
      if (img.bytes > MAX_IMAGE_BYTES * 0.9) heavy = true;
      placed++;
    } catch (e) {
      return (e as Error).message;
    }
  }

  if (placed === 0) return 'No image in that.';
  if (heavy) {
    return (
      'Added, but that image is close to the size limit — the map file carries ' +
      'it, so keep an eye on how many you pile up.'
    );
  }
  return null;
}
