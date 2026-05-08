import cv from '@techstark/opencv-js';

// Load an image File into a CV_8UC3 Mat (RGB channel order)
export function imreadFromFile(file: File): Promise<cv.Mat> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      const { data } = ctx.getImageData(0, 0, w, h); // RGBA
      const mat = new cv.Mat(h, w, cv.CV_8UC3);
      const dst = mat.data;
      for (let i = 0; i < h * w; i++) {
        dst[i * 3 + 0] = data[i * 4 + 0]; // R
        dst[i * 3 + 1] = data[i * 4 + 1]; // G
        dst[i * 3 + 2] = data[i * 4 + 2]; // B
      }
      resolve(mat);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to load image: ${file.name}`));
    };

    img.src = url;
  });
}

// Convert a CV_8UC3 Mat (RGB) to a JPEG data URL for display / download
export function matToDataUrl(mat: cv.Mat, quality = 0.92): string {
  const { rows: h, cols: w } = mat;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const rgba = new Uint8ClampedArray(h * w * 4);
  const rgb = mat.data;
  for (let i = 0; i < h * w; i++) {
    rgba[i * 4 + 0] = rgb[i * 3 + 0];
    rgba[i * 4 + 1] = rgb[i * 3 + 1];
    rgba[i * 4 + 2] = rgb[i * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }
  ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
  return canvas.toDataURL('image/jpeg', quality);
}
