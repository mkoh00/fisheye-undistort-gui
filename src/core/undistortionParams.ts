export interface UndistortionRawParams {
  k: [number, number, number, number]; // [fx, fy, cx, cy]
  d: [number, number, number, number]; // [k1, k2, k3, k4]
  p: [number, number, number, number]; // [fx, fy, cx, cy]
  r: number;                           // rotation angle in degrees
}

export interface UndistortionParams {
  k: number[][]; // 3x3 intrinsic matrix
  d: number[];   // [k1, k2, k3, k4] fisheye distortion coefficients
  p: number[][]; // 3x3 projection (new camera) matrix
  r: number[][]; // 3x3 rotation matrix
}

function buildCameraMatrix(params: [number, number, number, number]): number[][] {
  const [fx, fy, cx, cy] = params;
  return [
    [fx, 0, cx],
    [0, fy, cy],
    [0, 0, 1],
  ];
}

function buildRotationMatrix(degrees: number): number[][] {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    [cos, -sin, 0],
    [sin,  cos, 0],
    [0,    0,   1],
  ];
}

export function fromRawParams(raw: UndistortionRawParams): UndistortionParams {
  return {
    k: buildCameraMatrix(raw.k),
    d: [...raw.d],
    p: buildCameraMatrix(raw.p),
    r: buildRotationMatrix(raw.r),
  };
}
