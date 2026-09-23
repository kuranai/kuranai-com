import { useTheme, type ThemePreference } from './theme';

const themeOptions: Array<{ label: string; value: ThemePreference }> = [
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
  { label: 'System', value: 'system' },
];

export function ThemeControl() {
  const { preference, setPreference } = useTheme();

  return (
    <label className="theme-control">
      <span aria-hidden="true" className="theme-control-label">
        Theme
      </span>
      <select
        aria-label="Theme"
        onChange={(event) => setPreference(event.target.value as ThemePreference)}
        value={preference}
      >
        {themeOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
