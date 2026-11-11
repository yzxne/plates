// Shrinks a phone photo before upload: long edge 1280 px, JPEG. Keeps AI cost and upload time low.

export interface ResizedImage { data: string; media_type: 'image/jpeg'; preview: string; bytes: number }

async function decode(file: Blob): Promise<{ img: CanvasImageSource; w: number; h: number; close: () => void }> {
  if ('createImageBitmap' in window) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { img: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
    } catch { /* fall back to <img> (older Safari, HEIC edge cases) */ }
  }
  const url = URL.createObjectURL(file);
  const el = new Image();
  el.decoding = 'async';
  el.src = url;
  try {
    await el.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("That photo couldn't be opened. Try a JPEG or take it again.");
  }
  return { img: el, w: el.naturalWidth, h: el.naturalHeight, close: () => URL.revokeObjectURL(url) };
}

export async function resizePhoto(file: Blob, longEdge = 1280, quality = 0.8): Promise<ResizedImage> {
  const src = await decode(file);
  try {
    const scale = Math.min(1, longEdge / Math.max(src.w, src.h));
    const w = Math.max(1, Math.round(src.w * scale));
    const h = Math.max(1, Math.round(src.h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot process photos.');
    ctx.drawImage(src.img, 0, 0, w, h);
    const preview = canvas.toDataURL('image/jpeg', quality);
    const data = preview.slice(preview.indexOf(',') + 1);
    return { data, media_type: 'image/jpeg', preview, bytes: Math.round((data.length * 3) / 4) };
  } finally {
    src.close();
  }
}
