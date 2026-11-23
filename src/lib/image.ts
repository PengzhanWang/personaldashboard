/**
 * Browser-side image compression before uploading to Google Drive:
 * - Main image: WebP (fallback JPEG), max side 1400px, quality 0.82 (~100-200KB)
 * - Tiny preview thumbnail: ~48px wide (~600B) stored in Sheets for 0ms instant placeholder
 */
export interface CompressedImage {
  base64: string;
  mimeType: string;
  filename: string;
  thumb: string;
  sizeKb: number;
}

export async function compressImageFile(file: File): Promise<CompressedImage> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('图片解码失败'));
    el.src = dataUrl;
  });

  const maxSide = 1400;
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (w > maxSide || h > maxSide) {
    if (w > h) {
      h = Math.round((h * maxSide) / w);
      w = maxSide;
    } else {
      w = Math.round((w * maxSide) / h);
      h = maxSide;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 不可用');
  ctx.drawImage(img, 0, 0, w, h);

  let outUrl = canvas.toDataURL('image/webp', 0.82);
  let mimeType = 'image/webp';
  let ext = 'webp';
  if (!outUrl.startsWith('data:image/webp')) {
    outUrl = canvas.toDataURL('image/jpeg', 0.82);
    mimeType = 'image/jpeg';
    ext = 'jpg';
  }

  // Generate tiny blurred placeholder thumbnail (~48px wide)
  const tw = Math.min(48, w);
  const th = Math.max(1, Math.round((h * tw) / w));
  const tCanvas = document.createElement('canvas');
  tCanvas.width = tw;
  tCanvas.height = th;
  tCanvas.getContext('2d')?.drawImage(img, 0, 0, tw, th);
  const thumb = tCanvas.toDataURL(mimeType, 0.55);

  const base64 = outUrl.slice(outUrl.indexOf(',') + 1);
  const sizeKb = Math.max(1, Math.round((base64.length * 3) / 4 / 1024));
  const stem = (file.name || 'image').replace(/\.[^.]+$/, '').slice(0, 40) || 'image';

  return {
    base64,
    mimeType,
    filename: `${stem}-${Date.now()}.${ext}`,
    thumb,
    sizeKb,
  };
}
