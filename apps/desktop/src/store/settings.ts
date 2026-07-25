// User preferences store — separate from the main data store (which holds
// project/canvas data). Renderer-only, persisted to localStorage. Zoom
// sensitivity lives here; add future app settings via settingsSchema.ts.

import { create } from 'zustand';
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA, type Settings } from './settingsSchema';

const STORAGE_KEY = 'easle.settings.v1';

// Per-key [min, max] pulled from the schema, used to clamp every write so a bad
// value can never break the feature it drives (e.g. zoom).
const RANGES: Partial<Record<keyof Settings, { min: number; max: number }>> = {};
for (const section of SETTINGS_SCHEMA) {
  for (const f of section.fields) {
    if (f.type === 'range') RANGES[f.key] = { min: f.min, max: f.max };
  }
}

function clampNumber(key: keyof Settings, value: number): number {
  const r = RANGES[key];
  return r ? Math.max(r.min, Math.min(r.max, value)) : value;
}

function load(): Settings {
  const merged: Settings = { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return merged;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      // Fill known keys from storage (clamped); ignore unknown/removed keys.
      for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
        const v = (parsed as Record<string, unknown>)[key];
        if (typeof v === 'number') {
          (merged as unknown as Record<string, number>)[key] = clampNumber(key, v);
        }
      }
    }
  } catch {
    // corrupt storage — fall back to the defaults already in `merged`
  }
  return merged;
}

function persist(settings: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore write failures (private mode / quota) — settings stay in-memory
  }
}

interface SettingsStore {
  settings: Settings;
  open: boolean; // preferences panel visibility (shared by gear button + panel)
  set<K extends keyof Settings>(key: K, value: Settings[K]): void;
  reset<K extends keyof Settings>(key: K): void;
  setOpen(open: boolean): void;
  toggle(): void;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: load(),
  open: false,
  set(key, value) {
    const clamped = typeof value === 'number' ? clampNumber(key, value) : value;
    const next = { ...get().settings, [key]: clamped } as Settings;
    persist(next);
    set({ settings: next });
  },
  reset(key) {
    get().set(key, DEFAULT_SETTINGS[key]);
  },
  setOpen(open) { set({ open }); },
  toggle() { set((s) => ({ open: !s.open })); },
}));
