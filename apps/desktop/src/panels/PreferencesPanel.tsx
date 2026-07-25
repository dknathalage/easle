import { useSettings } from '../store/settings';
import { SETTINGS_SCHEMA, DEFAULT_SETTINGS, type Field } from '../store/settingsSchema';

// Right-side preferences panel. Renders itself from SETTINGS_SCHEMA, so new
// settings appear here automatically. Mounts only when `open`.
export function PreferencesPanel() {
  const open = useSettings((s) => s.open);
  const setOpen = useSettings((s) => s.setOpen);
  if (!open) return null;

  return (
    <div className="panel prefs-panel">
      <div className="panel-head">
        Preferences
        <button className="prefs-close" title="Close" onClick={() => setOpen(false)}>×</button>
      </div>
      <div className="panel-body">
        {SETTINGS_SCHEMA.map((section) => (
          <div key={section.id} className="prefs-section">
            <div className="prefs-section-title">{section.title}</div>
            {section.fields.map((f) => <FieldRow key={f.key} field={f} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

function FieldRow({ field }: { field: Field }) {
  const value = useSettings((s) => s.settings[field.key]);
  const set = useSettings((s) => s.set);
  const reset = useSettings((s) => s.reset);
  const isDefault = value === DEFAULT_SETTINGS[field.key];

  return (
    <div className="prefs-field">
      <div className="prefs-field-head">
        <label htmlFor={`pref-${field.key}`}>{field.label}</label>
        <button className="prefs-reset" disabled={isDefault} onClick={() => reset(field.key)}>Reset</button>
      </div>
      {field.type === 'range' && (
        <div className="prefs-range">
          <input
            id={`pref-${field.key}`}
            type="range"
            min={field.min}
            max={field.max}
            step={field.step}
            value={value}
            onChange={(e) => set(field.key, Number(e.target.value))}
          />
          <span className="prefs-value">{value.toFixed(3)}</span>
        </div>
      )}
      {field.help && <div className="prefs-help">{field.help}</div>}
    </div>
  );
}
