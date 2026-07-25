// Declarative preferences schema. The PreferencesPanel renders itself from this,
// and the settings store derives its defaults + clamp ranges from it — this file
// is the single source of truth for preferences. Add a setting by adding a field
// here and a matching key to `Settings`; no UI code changes needed.

// The typed settings object. Every key must correspond to a schema field.
export interface Settings {
  zoomSensitivity: number;
}

export interface RangeField {
  key: keyof Settings;
  label: string;
  type: 'range';
  min: number;
  max: number;
  step: number;
  default: number;
  help?: string;
}

// Only `range` exists today. New field types are added when a setting needs one.
export type Field = RangeField;

export interface Section {
  id: string;
  title: string;
  fields: Field[];
}

export const SETTINGS_SCHEMA: Section[] = [
  {
    id: 'canvas',
    title: 'Canvas',
    fields: [
      {
        key: 'zoomSensitivity',
        label: 'Zoom speed',
        type: 'range',
        min: 0.001,
        max: 0.02,
        step: 0.001,
        default: 0.006,
        help: 'Trackpad / wheel zoom sensitivity.',
      },
    ],
  },
];

// Defaults derived from the schema — values are declared once, in the schema.
export const DEFAULT_SETTINGS: Settings = (() => {
  const acc = {} as Record<string, number>;
  for (const section of SETTINGS_SCHEMA) {
    for (const f of section.fields) acc[f.key] = f.default;
  }
  return acc as unknown as Settings;
})();
