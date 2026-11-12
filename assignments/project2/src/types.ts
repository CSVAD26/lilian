/** Shapes of public/data/photos.json, written by scripts/preprocess.py. */

export interface Rect {
  /** Normalized position on the shared canvas, 0..1, y pointing down. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Photo {
  id: string;
  source: string;
  /** Local capture time, ISO without timezone, e.g. "2023-05-01T14:22:10". */
  date: string;
  dateSource: 'exif' | 'file';
  utcOffset: string | null;
  lat: number | null;
  lon: number | null;
  original: { width: number; height: number; orientation: number };
  rect: Rect;
  preview: { atlas: number; x: number; y: number; w: number; h: number };
  hires: { file: string; width: number; height: number };
}

export interface Manifest {
  version: number;
  generated: string;
  canvas: { width: number; height: number };
  preview: { width: number; height: number; atlases: { file: string; width: number; height: number }[] };
  hires: { width: number; height: number };
  photos: Photo[];
}

/** Photo plus fields derived in the browser. */
export interface PhotoItem extends Photo {
  /** Capture time in ms (local time). */
  time: number;
}
