import cv from '@techstark/opencv-js';

export function waitForOpenCV(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof (cv as any).Mat === 'function') {
      resolve();
    } else {
      (cv as any).onRuntimeInitialized = resolve;
    }
  });
}
