// Google Sheet schema shared by the backend (creates/validates tabs) and frontend.
// Documented in docs/data-model.md — keep both in sync.

export const SCHEMA_VERSION = 3;

export const TABS = {
  Settings: ['id', 'key', 'value', 'created_at', 'updated_at'],
  Foods: [
    'id', 'name', 'brand', 'source', 'source_id', 'barcode',
    'serving_size', 'serving_unit', 'grams_per_serving',
    'kcal_100g', 'protein_g_100g', 'carbs_g_100g', 'fat_g_100g', 'fiber_g_100g', 'sugar_g_100g', 'sodium_mg_100g',
    'kcal_serving', 'protein_g_serving', 'carbs_g_serving', 'fat_g_serving', 'fiber_g_serving', 'sugar_g_serving', 'sodium_mg_serving',
    'created_at', 'updated_at', 'deleted_at',
    // v3
    'favorite',
  ],
  FoodLog: [
    'id', 'date', 'meal', 'food_id', 'food_name', 'grams', 'servings',
    'kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g', 'sodium_mg',
    'entry_method', 'notes', 'created_at', 'updated_at', 'deleted_at',
    // v3
    'food_source', 'place', 'is_estimate',
  ],
  Days: [
    'id', 'date', 'day_complete',
    'total_kcal', 'total_protein_g', 'total_carbs_g', 'total_fat_g',
    'target_kcal', 'target_protein_g', 'target_carbs_g', 'target_fat_g',
    'created_at', 'updated_at',
  ],
  Weights: ['id', 'date', 'time', 'weight_lb', 'body_fat_pct', 'notes', 'created_at', 'updated_at', 'deleted_at'],
  Exercises: [
    'id', 'name', 'primary_muscles', 'secondary_muscles', 'equipment', 'default_rest_sec', 'notes',
    'created_at', 'updated_at', 'deleted_at',
  ],
  Routines: ['id', 'name', 'notes', 'sort_order', 'created_at', 'updated_at', 'deleted_at'],
  RoutineExercises: [
    'id', 'routine_id', 'exercise_id', 'position', 'rest_sec', 'planned_sets_json', 'notes',
    'created_at', 'updated_at', 'deleted_at',
  ],
  Workouts: [
    'id', 'routine_id', 'date', 'start_time', 'end_time', 'duration_sec', 'notes',
    'created_at', 'updated_at', 'deleted_at',
    // v2
    'name', 'exercise_notes_json',
  ],
  Sets: [
    'id', 'workout_id', 'exercise_id', 'exercise_order', 'set_order', 'set_type',
    'weight_lb', 'reps', 'rep_min', 'rep_max', 'completed', 'rpe', 'note',
    'created_at', 'updated_at', 'deleted_at',
  ],
  CheckIns: [
    'id', 'date', 'trend_weight_lb', 'expenditure_kcal', 'confidence', 'weekly_budget_kcal',
    'day_targets_json', 'reason', 'created_at', 'updated_at',
  ],
  // v3: your usual portion sizes for AI estimates (Phase 6)
  Portions: ['id', 'source', 'place', 'label', 'grams', 'measured', 'created_at', 'updated_at', 'deleted_at'],
  // v3: several foods logged together with one tap ("usual breakfast")
  SavedMeals: ['id', 'name', 'items_json', 'created_at', 'updated_at', 'deleted_at'],
  AIUsage: ['id', 'date', 'request_id', 'model', 'input_tokens', 'output_tokens', 'cost_usd', 'created_at', 'updated_at'],
} as const satisfies Record<string, readonly string[]>;

export type TabName = keyof typeof TABS;
export const TAB_NAMES = Object.keys(TABS) as TabName[];

export function isTabName(name: unknown): name is TabName {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(TABS, name);
}

export type Cell = string | number | boolean;
export type Row = Record<string, Cell>;

// ---------- Settings ----------

export interface Option { value: string; label: string }

export interface SettingField {
  key: string;
  label: string;
  type: 'select' | 'number' | 'date' | 'days' | 'text' | 'window' | 'hidden' | 'readonly';
  default: string;
  options?: Option[];
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  help?: string;
  group?: 'advanced';
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export const SETTINGS_FIELDS: SettingField[] = [
  { key: 'sex', label: 'Sex', type: 'select', default: '', help: 'Used only for the resting-rate formula.',
    options: [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }] },
  { key: 'birth_date', label: 'Birth date', type: 'date', default: '' },
  { key: 'height_in', label: 'Height', type: 'number', unit: 'in', min: 36, max: 96, step: 0.5, default: '',
    help: 'Inches. 70 in = 5 ft 10 in.' },
  // [Assumption] Common activity multipliers; source documented in docs/algorithm.md (Phase 5).
  { key: 'activity_multiplier', label: 'Activity level', type: 'select', default: '1.375', options: [
    { value: '1.2', label: 'Sedentary (×1.2)' },
    { value: '1.375', label: 'Lightly active (×1.375)' },
    { value: '1.55', label: 'Moderately active (×1.55)' },
    { value: '1.725', label: 'Very active (×1.725)' },
    { value: '1.9', label: 'Extremely active (×1.9)' },
  ] },
  { key: 'goal_type', label: 'Goal', type: 'select', default: 'maintain', options: [
    { value: 'lose', label: 'Lose weight' },
    { value: 'maintain', label: 'Maintain' },
    { value: 'gain', label: 'Gain weight' },
  ] },
  { key: 'goal_rate_lb_per_week', label: 'Goal rate', type: 'number', unit: 'lb/week', min: 0, max: 2, step: 0.1, default: '0.5' },
  { key: 'protein_g_per_lb', label: 'Protein target', type: 'number', unit: 'g per lb', min: 0.3, max: 1.5, step: 0.05, default: '0.8' },
  { key: 'fat_min_g', label: 'Fat minimum', type: 'number', unit: 'g/day', min: 0, max: 300, step: 1, default: '50' },
  { key: 'checkin_weekday', label: 'Check-in day', type: 'select', default: 'Mon',
    options: WEEKDAYS.map((d) => ({ value: d, label: d })) },
  { key: 'training_days', label: 'Training days', type: 'days', default: 'Mon,Wed,Fri' },
  { key: 'breakfast_window', label: 'Breakfast time', type: 'window', default: '04:00-10:59',
    help: 'Food logged in this window goes to Breakfast automatically.' },
  { key: 'lunch_window', label: 'Lunch time', type: 'window', default: '11:00-15:59' },
  { key: 'dinner_window', label: 'Dinner time', type: 'window', default: '16:00-20:59',
    help: 'Anything outside these windows is a Snack.' },
  { key: 'cafeteria_name', label: 'Cafeteria', type: 'text', default: '', help: 'Default place for "Cafeteria" AI estimates.' },
  { key: 'plate_diameter_in', label: 'Plate diameter', type: 'number', unit: 'in', min: 5, max: 16, step: 0.25, default: '10.5',
    help: 'Scale reference for AI meal photos.' },
  { key: 'ai_monthly_cap_usd', label: 'AI monthly cap', type: 'number', unit: 'USD', min: 0, max: 50, step: 0.5, default: '1' },
  // Coaching constants (docs/algorithm.md). [Assumption] defaults — tune after a few weeks of data.
  { key: 'training_day_shift_pct', label: 'Training-day extra', type: 'number', unit: '%', min: 0, max: 40, step: 1, default: '10', group: 'advanced',
    help: 'Training days get this much more than the daily average; other days get less. Weekly total stays the same.' },
  { key: 'fat_pct', label: 'Fat share of calories', type: 'number', unit: '%', min: 15, max: 50, step: 1, default: '25', group: 'advanced',
    help: 'Never below your fat minimum.' },
  { key: 'min_calories', label: 'Calorie floor', type: 'number', unit: 'kcal', min: 800, max: 3000, step: 50, default: '1200', group: 'advanced' },
  { key: 'max_target_change', label: 'Max weekly change', type: 'number', unit: 'kcal/day', min: 25, max: 500, step: 25, default: '150', group: 'advanced' },
  { key: 'energy_per_lb', label: 'Energy per lb of weight', type: 'number', unit: 'kcal', min: 1500, max: 3500, step: 50, default: '2700', group: 'advanced',
    help: 'Used instead of the old 3,500 kcal/lb rule (see docs/algorithm.md).' },
  { key: 'trend_alpha', label: 'Trend smoothing', type: 'number', min: 0.02, max: 0.5, step: 0.01, default: '0.1', group: 'advanced',
    help: 'Higher = trend follows the scale faster.' },
  { key: 'expenditure_window_days', label: 'Expenditure window', type: 'number', unit: 'days', min: 14, max: 42, step: 1, default: '21', group: 'advanced' },
  { key: 'setup_complete', label: 'Setup done', type: 'hidden', default: '' },
  { key: 'units', label: 'Units', type: 'readonly', default: 'lb' },
  { key: 'timezone', label: 'Time zone', type: 'readonly', default: 'America/Chicago' },
  { key: 'schema_version', label: 'Schema version', type: 'readonly', default: String(SCHEMA_VERSION) },
];

export const SETTINGS_DEFAULTS: Record<string, string> = Object.fromEntries(
  SETTINGS_FIELDS.map((f) => [f.key, f.default]),
);

export interface SettingsValidation {
  ok: boolean;
  errors: Record<string, string>;
  clean: Record<string, string>;
}

/** Validates user-editable settings. Read-only and unknown keys are rejected. */
export function validateSettings(input: Record<string, unknown>): SettingsValidation {
  const errors: Record<string, string> = {};
  const clean: Record<string, string> = {};
  const fields = new Map(SETTINGS_FIELDS.map((f) => [f.key, f]));

  for (const [key, raw] of Object.entries(input)) {
    const field = fields.get(key);
    if (!field) { errors[key] = 'Unknown setting'; continue; }
    if (field.type === 'readonly') { errors[key] = 'This setting cannot be changed'; continue; }
    const value = raw == null ? '' : String(raw).trim();
    if (value === '') { clean[key] = ''; continue; }

    switch (field.type) {
      case 'number': {
        const n = Number(value);
        if (!Number.isFinite(n)) { errors[key] = 'Must be a number'; break; }
        if (field.min !== undefined && n < field.min) { errors[key] = `Must be at least ${field.min}`; break; }
        if (field.max !== undefined && n > field.max) { errors[key] = `Must be at most ${field.max}`; break; }
        clean[key] = String(n);
        break;
      }
      case 'select':
        if (!field.options?.some((o) => o.value === value)) errors[key] = 'Not a valid option';
        else clean[key] = value;
        break;
      case 'date': {
        const ok = /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z'));
        if (!ok) errors[key] = 'Use YYYY-MM-DD';
        else clean[key] = value;
        break;
      }
      case 'text':
        if (value.length > 80) errors[key] = 'Keep it under 80 characters';
        else clean[key] = value;
        break;
      case 'hidden':
        if (value.length > 40) errors[key] = 'Too long';
        else clean[key] = value;
        break;
      case 'window': {
        const w = parseWindow(value);
        if (!w) errors[key] = 'Use HH:MM-HH:MM, e.g. 11:00-15:59';
        else clean[key] = value.replace(/\s+/g, '');
        break;
      }
      case 'days': {
        const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
        const bad = parts.filter((p) => !(WEEKDAYS as readonly string[]).includes(p));
        if (bad.length) errors[key] = `Unknown day: ${bad.join(', ')}`;
        else clean[key] = WEEKDAYS.filter((d) => parts.includes(d)).join(',');
        break;
      }
    }
  }
  return { ok: Object.keys(errors).length === 0, errors, clean };
}

// ---------- Meal time windows ----------

/** "11:00-15:59" → minutes since midnight [start, end] (end inclusive). */
export function parseWindow(v: string): [number, number] | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(v);
  if (!m) return null;
  const [h1, m1, h2, m2] = [m[1], m[2], m[3], m[4]].map(Number) as [number, number, number, number];
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return null;
  const a = h1 * 60 + m1;
  const b = h2 * 60 + m2;
  return b >= a ? [a, b] : null;
}

export type MealName = 'breakfast' | 'lunch' | 'dinner' | 'snack';

/** Meal for a clock time (minutes since midnight, America/Chicago), using the Settings windows. */
export function mealForMinutes(minutes: number, settings: Record<string, string>): MealName {
  for (const meal of ['breakfast', 'lunch', 'dinner'] as const) {
    const w = parseWindow(settings[`${meal}_window`] ?? SETTINGS_DEFAULTS[`${meal}_window`] ?? '');
    if (w && minutes >= w[0] && minutes <= w[1]) return meal;
  }
  return 'snack';
}

// ---------- Time helpers ----------

export const APP_TIMEZONE = 'America/Chicago';

/** Calendar date (YYYY-MM-DD) in America/Chicago for the given instant. */
export function chicagoDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at);
}
