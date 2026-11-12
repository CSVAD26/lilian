/**
 * Shared app state. Every view reads the selection from here and changes it
 * only through these setters, so new views (map, mosaic, tag filters...) can be
 * added without the existing ones knowing about them.
 *
 * To add a new kind of filter: add a field + setter, and include it in
 * computeSelection().
 */
import { create } from 'zustand';
import type { Manifest, PhotoItem } from './types';

export type Snap = 'year' | 'month';

interface State {
  manifest: Manifest | null;
  photos: PhotoItem[];
  /** Selected time range in ms, [start, end). null = everything. */
  range: [number, number] | null;
  snap: Snap;
  linear: boolean;
  /** Derived: photos passing all filters. */
  selected: PhotoItem[];

  setManifest: (m: Manifest) => void;
  setRange: (r: [number, number] | null) => void;
  setSnap: (s: Snap) => void;
  setLinear: (b: boolean) => void;
}

function computeSelection(photos: PhotoItem[], range: State['range']): PhotoItem[] {
  if (!range) return photos;
  const [a, b] = range;
  return photos.filter((p) => p.time >= a && p.time < b);
}

export const useStore = create<State>()((set, get) => ({
  manifest: null,
  photos: [],
  range: null,
  snap: 'year',
  linear: false,
  selected: [],

  setManifest: (manifest) => {
    // "2023-05-01T14:22:10" (no zone) parses as local time, so year boundaries line up.
    const photos = manifest.photos
      .map((p) => ({ ...p, time: new Date(p.date).getTime() }))
      .sort((a, b) => a.time - b.time);
    set({ manifest, photos, range: null, selected: photos });
  },

  setRange: (range) => {
    const cur = get().range;
    if (cur === range || (cur && range && cur[0] === range[0] && cur[1] === range[1])) return;
    set({ range, selected: computeSelection(get().photos, range) });
  },

  setSnap: (snap) => set({ snap }),
  setLinear: (linear) => set({ linear }),
}));
