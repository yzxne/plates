import { describe, expect, it } from 'vitest';
import { chicagoDate, mealForMinutes, parseWindow, SETTINGS_FIELDS, TABS, TAB_NAMES, validateSettings } from '../../shared/schema';
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

describe('meal time windows', () => {
  const at = (h: number, m = 0) => h * 60 + m;
  it('uses the default windows', () => {
    expect([at(4), at(10, 59), at(11), at(15, 59), at(16), at(20, 59), at(21), at(3, 59)].map((t) => mealForMinutes(t, {})))
      .toEqual(['breakfast', 'breakfast', 'lunch', 'lunch', 'dinner', 'dinner', 'snack', 'snack']);
  });
  it('follows windows from Settings', () => {
    const s = { breakfast_window: '06:00-11:30', lunch_window: '11:31-14:00', dinner_window: '17:00-21:00' };
    expect(mealForMinutes(at(10, 45), s)).toBe('breakfast');
    expect(mealForMinutes(at(15), s)).toBe('snack');
    expect(mealForMinutes(at(21), s)).toBe('dinner');
  });
  it('validates window text', () => {
    expect(parseWindow('11:00-15:59')).toEqual([660, 959]);
    expect(parseWindow('15:00-11:00')).toBeNull();
    expect(parseWindow('25:00-26:00')).toBeNull();
    expect(validateSettings({ lunch_window: '11:00 - 15:59' }).clean).toEqual({ lunch_window: '11:00-15:59' });
    expect(validateSettings({ lunch_window: 'noon' }).ok).toBe(false);
    expect(validateSettings({ cafeteria_name: 'FHSU McMindes', setup_complete: 'true' }).ok).toBe(true);
  });
});
