import { describe, expect, it } from 'vitest';
import { chicagoDate, SETTINGS_FIELDS, TABS, TAB_NAMES, validateSettings } from '../../shared/schema';
import { colLetter } from '../src/sheets';

describe('schema', () => {
  it('every tab has id, created_at and updated_at, with unique columns', () => {
    for (const tab of TAB_NAMES) {
      const cols = TABS[tab] as readonly string[];
      expect(cols[0]).toBe('id');
      expect(cols).toContain('created_at');
      expect(cols).toContain('updated_at');
      expect(new Set(cols).size).toBe(cols.length);
    }
  });

  it('every setting has a valid default', () => {
    const editable = Object.fromEntries(SETTINGS_FIELDS.filter((f) => f.type !== 'readonly').map((f) => [f.key, f.default]));
    expect(validateSettings(editable).errors).toEqual({});
  });
});

describe('validateSettings', () => {
  it('normalizes numbers and day lists', () => {
    const v = validateSettings({ goal_rate_lb_per_week: ' 0.50 ', training_days: 'Sun, Mon,Wed' });
    expect(v.ok).toBe(true);
    expect(v.clean).toEqual({ goal_rate_lb_per_week: '0.5', training_days: 'Mon,Wed,Sun' });
  });

  it('rejects out-of-range numbers, bad options, bad dates, read-only and unknown keys', () => {
    const v = validateSettings({
      goal_rate_lb_per_week: '3', goal_type: 'bulk', birth_date: '2026-13-40', units: 'kg', nope: 'x', height_in: 'abc', training_days: 'Funday',
    });
    expect(v.ok).toBe(false);
    expect(Object.keys(v.errors).sort()).toEqual(['birth_date', 'goal_rate_lb_per_week', 'goal_type', 'height_in', 'nope', 'training_days', 'units']);
  });

  it('allows clearing an optional value', () => {
    expect(validateSettings({ birth_date: '' }).clean).toEqual({ birth_date: '' });
  });
});

describe('helpers', () => {
  it('converts column numbers to letters', () => {
    expect([1, 26, 27, 52, 53, 702, 703].map(colLetter)).toEqual(['A', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA']);
  });

  it('uses America/Chicago for calendar dates', () => {
    // 2026-11-10 03:00 UTC is still Nov 9 in Chicago (UTC-6).
    expect(chicagoDate(new Date('2026-11-10T03:00:00Z'))).toBe('2026-11-09');
    expect(chicagoDate(new Date('2026-11-10T07:00:00Z'))).toBe('2026-11-10');
  });
});
