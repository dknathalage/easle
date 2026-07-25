# Preferences side panel (general shell, seeded with zoom)

**Date:** 2026-07-25
**Status:** Approved

## Goal

Give Easle a persistent, extensible preferences UI. First setting: trackpad/wheel
**zoom sensitivity** (currently a hardcoded constant in `Canvas.tsx`). The UI is a
general "shell" — a schema-driven side panel — so future app settings drop in with
no new UI code.

## Decisions

- **Scope:** general preferences shell, seeded with a single Canvas setting (zoom speed).
- **Presentation:** slide-in right-side panel, reusing existing `.panel` styling (like Notes).
- **Access:** ⚙ gear icon in the top bar.
- **Persistence:** `localStorage` (renderer-only). Zoom sensitivity is a renderer concern.

## Architecture

### 1. Settings store — `src/store/settings.ts` (new)

A dedicated Zustand store, separate from the main data store (`store.ts`, already
~380 lines, holds project/canvas data). Owns:

- `settings`: typed object with defaults, e.g. `{ zoomSensitivity: number }`.
- `open`: boolean — whether the panel is visible (shared by gear + panel).
- `set(key, value)`: updates state, **clamps** to the field's range, persists to localStorage.
- `toggle()` / `setOpen(b)`: panel visibility.
- Hydration from `localStorage` key `easle.settings.v1` on module load; parse failure
  or missing key → defaults. Unknown keys ignored; missing keys filled from defaults.

### 2. Schema registry — `src/store/settingsSchema.ts` (new)

Declarative sections → fields drive the panel:

```ts
export const SETTINGS_SCHEMA = [
  { id: 'canvas', title: 'Canvas', fields: [
    { key: 'zoomSensitivity', label: 'Zoom speed', type: 'range',
      min: 0.001, max: 0.02, step: 0.001, default: 0.006 },
  ]},
] as const;
```

Defaults for the settings store are derived from this schema (single source of truth).
Adding a setting = add a field here + a key to the settings type. Only the `range`
field type exists for now; new types are added when a setting needs one (YAGNI).

### 3. `src/panels/PreferencesPanel.tsx` (new)

Right-side panel, reuses `.panel` / `.panel-head` / `.panel-body`. Renders sections
and fields from `SETTINGS_SCHEMA`, each bound to the settings store. The zoom field is
a `<input type="range">` slider with its numeric value shown beneath and a per-field
"Reset" to the schema default. Only mounts when `open` is true.

### 4. Gear icon — in `src/panels/VersionBar.tsx` (top bar)

A ⚙ button near Versions that calls `toggle()`. Panel and button share `open` state.

### 5. Wire zoom — `src/canvas/Canvas.tsx`

Remove the module const `ZOOM_SENSITIVITY` (line 10). The wheel handler reads
`zoomSensitivity` from the settings store instead. Changes apply live (next wheel event).

### 6. Styling — `src/styles/app.css`

Add `.prefs-panel` (mirrors `.notes-panel`), plus field row styles (label, slider,
value readout, reset button). Add the gear button style in the top bar.

## Data flow

load → settings store hydrates from localStorage (or defaults) → gear toggles `open`
→ panel renders fields from schema → editing a field calls `set()` → value clamped,
state updated, localStorage written → `Canvas` re-reads `zoomSensitivity` on the next
wheel event.

## Error handling

- Corrupt/absent localStorage → defaults.
- All writes clamped to the field's `[min, max]` so a bad value can never break zoom.
- Versioned storage key (`v1`) allows a future migration path.

## Testing

No test tooling exists in the repo; verification is manual:

1. `npm run build` succeeds.
2. Launch the app; ⚙ opens/closes the panel.
3. Dragging the zoom slider changes trackpad zoom speed **live** (no reload).
4. The chosen value survives an app restart (localStorage persistence).

No test framework is introduced as part of this feature.

## Out of scope (YAGNI)

- Import/export of settings; per-project settings.
- Field types beyond `range`.
- Main-process-backed settings via IPC (add later if a setting needs the main process).
- Syncing settings with the dev DB.
