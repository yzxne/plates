import { useEffect, useState } from 'preact/hooks';

interface Props {
  value: number | null | undefined;
  onValue: (v: number | null) => void;
  decimal?: boolean;
  [attr: string]: unknown;
}

/**
 * Number field that keeps what you're typing ("135." stays "135." instead of snapping back to "135" and losing the cursor).
 * Text input with a numeric keypad, so iPhone can select-all on focus.
 */
export function NumInput({ value, onValue, decimal = true, ...rest }: Props) {
  const shown = value == null || Number.isNaN(value) ? '' : String(value);
  const [draft, setDraft] = useState(shown);
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(shown); }, [shown, focused]);

  return (
    <input {...rest} type="text" inputMode={decimal ? 'decimal' : 'numeric'} autoComplete="off"
      value={focused ? draft : shown}
      onFocus={() => { setDraft(shown); setFocused(true); }}
      onBlur={() => setFocused(false)}
      onInput={(e) => {
        const raw = e.currentTarget.value.replace(',', '.');
        const clean = decimal ? raw.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1') : raw.replace(/\D/g, '');
        if (clean !== e.currentTarget.value) e.currentTarget.value = clean;
        setDraft(clean);
        if (clean === '' ) onValue(null);
        else if (clean !== '.') onValue(decimal ? Number(clean) : Math.round(Number(clean)));
      }} />
  );
}

/** Select a number field's contents when it's tapped, so you can type over it. */
export function installSelectOnFocus(): void {
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement)) return;
    const mode = el.getAttribute('inputmode');
    if (mode !== 'decimal' && mode !== 'numeric') return;
    // iPhone clears the selection on the tap that focused the field, so select after it settles.
    setTimeout(() => { if (document.activeElement === el) { try { el.select(); } catch { /* not selectable */ } } }, 0);
  });
}
