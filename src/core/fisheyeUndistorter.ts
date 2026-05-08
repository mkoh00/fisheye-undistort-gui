import cv from '@techstark/opencv-js';
import { UndistortionParams } from './undistortionParams';

type Point2D = [number, number];

function computeFisheyeMaps(
  K: number[][], D: number[], R: number[][], P: number[][],
  outWidth: number, outHeight: number,
): [Float32Array, Float32Array] {
  const map1 = new Float32Array(outHeight * outWidth);
  const map2 = new Float32Array(outHeight * outWidth);

  const [k1, k2, k3, k4] = D;
  const fx_p = P[0][0], fy_p = P[1][1], cx_p = P[0][2], cy_p = P[1][2];
  const fx_k = K[0][0], fy_k = K[1][1], cx_k = K[0][2], cy_k = K[1][2];

  const rt00 = R[0][0], rt01 = R[1][0], rt02 = R[2][0];
  const rt10 = R[0][1], rt11 = R[1][1], rt12 = R[2][1];
  const rt20 = R[0][2], rt21 = R[1][2], rt22 = R[2][2];

  for (let v = 0; v < outHeight; v++) {
    for (let u = 0; u < outWidth; u++) {
      const x = (u - cx_p) / fx_p;
      const y = (v - cy_p) / fy_p;

      const Xw = rt00 * x + rt01 * y + rt02;
      const Yw = rt10 * x + rt11 * y + rt12;
      const Zw = rt20 * x + rt21 * y + rt22;

      const a = Xw / Zw;
      const b = Yw / Zw;

      const r = Math.sqrt(a * a + b * b);
      const theta = Math.atan(r);
      const t2 = theta * theta;
      const theta_d = theta * (1 + k1 * t2 + k2 * t2 * t2 + k3 * t2 * t2 * t2 + k4 * t2 * t2 * t2 * t2);

      const scale = r > 1e-8 ? theta_d / r : 1.0;
      const xd = a * scale;
      const yd = b * scale;

      const idx = v * outWidth + u;
      map1[idx] = fx_k * xd + cx_k;
      map2[idx] = fy_k * yd + cy_k;
    }
  }

  return [map1, map2];
}

function invertFisheyeDistortion(rd: number, D: number[]): number {
  const [k1, k2, k3, k4] = D;
  let theta = rd;
  for (let i = 0; i < 10; i++) {
    const t2 = theta * theta;
    const fn = theta * (1 + k1 * t2 + k2 * t2 * t2 + k3 * t2 * t2 * t2 + k4 * t2 * t2 * t2 * t2) - rd;
    const dfn = 1 + 3 * k1 * t2 + 5 * k2 * t2 * t2 + 7 * k3 * t2 * t2 * t2 + 9 * k4 * t2 * t2 * t2 * t2;
    theta -= fn / dfn;
  }
  return theta;
}

export class FisheyeUndistorter {
  private readonly params: UndistortionParams;
  private readonly map1Mat: cv.Mat;
  private readonly map2Mat: cv.Mat;
  private readonly map1Data: Float32Array;
  private readonly map2Data: Float32Array;
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number, params: UndistortionParams) {
    this.width = width;
    this.height = height;
    this.params = params;

    const [map1, map2] = computeFisheyeMaps(params.k, params.d, params.r, params.p, width, height);
    this.map1Data = map1;
    this.map2Data = map2;

    this.map1Mat = new cv.Mat(height, width, cv.CV_32FC1);
    this.map2Mat = new cv.Mat(height, width, cv.CV_32FC1);
    this.map1Mat.data32F.set(map1);
    this.map2Mat.data32F.set(map2);
  }

  dispose(): void {
    this.map1Mat.delete();
    this.map2Mat.delete();
  }

  undistortImage(image: cv.Mat): cv.Mat {
    const dst = new cv.Mat();
    cv.remap(image, dst, this.map1Mat, this.map2Mat, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 0));
    return dst;
  }

  drawUndistortionBoundaries(
    dst: cv.Mat,
    color: cv.Scalar = new cv.Scalar(0, 255, 0, 255),
    thickness = 2,
  ): void {
    const { width: w, height: h } = this;

    const drawCurve = (pts: Point2D[], closed: boolean): void => {
      const distorted = this.mapToDistorted(pts);
      const flat = distorted.flatMap(([x, y]) => [Math.round(x), Math.round(y)]);
      const ptsMat = cv.matFromArray(distorted.length, 1, cv.CV_32SC2, flat);
      const vec = new cv.MatVector();
      vec.push_back(ptsMat);
      cv.polylines(dst, vec, closed, color, thickness, cv.LINE_8, 0);
      vec.delete();
      ptsMat.delete();
    };

    const boundary: Point2D[] = [];
    for (let x = 0; x < w; x++) boundary.push([x, 0]);
    for (let y = 1; y < h; y++) boundary.push([w - 1, y]);
    for (let x = w - 2; x >= 0; x--) boundary.push([x, h - 1]);
    for (let y = h - 2; y > 0; y--) boundary.push([0, y]);
    drawCurve(boundary, true);

    const vertical: Point2D[] = [];
    for (let y = 0; y < h; y++) vertical.push([Math.floor(w / 2), y]);
    drawCurve(vertical, false);

    const horizontal: Point2D[] = [];
    for (let x = 0; x < w; x++) horizontal.push([x, Math.floor(h / 2)]);
    drawCurve(horizontal, false);
  }

  undistortPoints(points: Point2D[]): Point2D[] {
    const { k, d, r, p } = this.params;
    const fx_k = k[0][0], fy_k = k[1][1], cx_k = k[0][2], cy_k = k[1][2];
    const fx_p = p[0][0], fy_p = p[1][1], cx_p = p[0][2], cy_p = p[1][2];

    return points.map(([u, v]) => {
      const xd = (u - cx_k) / fx_k;
      const yd = (v - cy_k) / fy_k;

      const rd = Math.sqrt(xd * xd + yd * yd);
      const theta = invertFisheyeDistortion(rd, d);

      const scale = rd > 1e-8 ? Math.tan(theta) / rd : 1.0;
      const x = xd * scale;
      const y = yd * scale;

      const Xr = r[0][0] * x + r[0][1] * y + r[0][2];
      const Yr = r[1][0] * x + r[1][1] * y + r[1][2];
      const Zr = r[2][0] * x + r[2][1] * y + r[2][2];
      const xn = Xr / Zr;
      const yn = Yr / Zr;

      return [fx_p * xn + cx_p, fy_p * yn + cy_p] as Point2D;
    });
  }

  distortPoints(points: Point2D[]): Point2D[] {
    return points.map(([x, y]) => {
      const idx = Math.round(y) * this.width + Math.round(x);
      return [this.map1Data[idx], this.map2Data[idx]];
    });
  }

  private mapToDistorted(points: Point2D[]): Point2D[] {
    return points.map(([x, y]) => {
      const idx = y * this.width + x;
      return [this.map1Data[idx], this.map2Data[idx]];
    });
  }
}
