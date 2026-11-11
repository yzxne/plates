// Parses nutrition-label text copied with iPhone Live Text.
// Handles US "Nutrition Facts" panels (per serving) and EU-style "per 100 g" tables.
// Everything it returns is shown to you for confirmation before saving.

export interface ParsedLabel {
  basis: 'serving' | 'per100g';
  servingText: string | null;
  servingGrams: number | null;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  sugar_g: number | null;
  sodium_mg: number | null;
  warnings: string[];
}

const NUM = String.raw`(<\s*)?(\d+(?:[.,]\d+)?)`;

function normalize(text: string): string {
  return text
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    // OCR often reads 0 as O/o before a unit: "Og", "O mg"
    .replace(/(^|[\s(])[Oo](?=\s*(?:g|mg|kcal)\b)/g, '$10')
    // and 1/l confusion inside numbers like "l2g"
    .replace(/(^|[\s(])[lI](?=\d)/g, '$11')
    .replace(/\s*\n\s*/g, ' \n ')
    .toLowerCase();
}

/** Finds the first "<label> <number><unit>" match. Returns value and whether it was "<". */
function grab(text: string, labels: RegExp, unit: string): { value: number; lessThan: boolean } | null {
  const re = new RegExp(`(?:${labels.source})[^\\d<\\n]{0,24}?\\s*${NUM}\\s*(${unit})\\b`, 'i');
  const m = re.exec(text.replace(/\n/g, ' '));
  if (!m) return null;
  return { value: Number(m[2]!.replace(',', '.')), lessThan: !!m[1] };
}

export function parseLabel(raw: string): ParsedLabel {
  const warnings: string[] = [];
  const text = normalize(raw);
  const flat = text.replace(/\n/g, ' ').replace(/\s+/g, ' ');

  const per100 = /per\s*100\s*g|\/\s*100\s*g|pro\s*100\s*g/.test(flat);
  let servingText: string | null = null;
  let servingGrams: number | null = null;

  const serving = /serving size\s*:?\s*(.*?)(?:\(\s*)?(\d+(?:[.,]\d+)?)\s*(g|ml)\b\s*\)?/i.exec(flat);
  if (serving) {
    const before = serving[1]!.trim().replace(/[(:]+$/, '').trim();
    servingGrams = Number(serving[2]!.replace(',', '.'));
    servingText = before ? `${before} (${serving[2]} ${serving[3]})` : `${serving[2]} ${serving[3]}`;
    if (serving[3] === 'ml') warnings.push('Serving is in mL; treated as grams (1 mL ≈ 1 g). Adjust if needed.');
  }

  const basis: ParsedLabel['basis'] = per100 && !serving ? 'per100g' : 'serving';
  if (basis === 'per100g') servingGrams = 100;

  // Energy: prefer an explicit kcal value (EU labels list kJ and kcal), then "Calories N".
  let kcal: number | null = null;
  const kcalMatch = /(\d+(?:[.,]\d+)?)\s*kcal/.exec(flat);
  const calMatch = /calories(?!\s*from)\s*:?\s*(\d+(?:[.,]\d+)?)/.exec(flat);
  if (calMatch) kcal = Number(calMatch[1]!.replace(',', '.'));
  else if (kcalMatch) kcal = Number(kcalMatch[1]!.replace(',', '.'));
  else {
    const kj = /(\d+(?:[.,]\d+)?)\s*kj/.exec(flat);
    if (kj) {
      kcal = Math.round(Number(kj[1]!.replace(',', '.')) / 4.184);
      warnings.push('Calories converted from kJ.');
    }
  }

  const take = (name: string, found: { value: number; lessThan: boolean } | null): number | null => {
    if (!found) return null;
    if (found.lessThan) {
      warnings.push(`${name} listed as "less than ${found.value}" — set to 0.`);
      return 0;
    }
    return found.value;
  };

  const fat = take('Fat', grab(flat, /total fat|\bfat\b/, 'g'));
  const carbs = take('Carbs', grab(flat, /total carbohydrates?|total carb\.?s?|\bcarbohydrates?\b|\bcarbs\b/, 'g'));
  const fiber = take('Fiber', grab(flat, /dietary fib(?:er|re)|\bfib(?:er|re)\b/, 'g'));
  const sugarTotal = grab(flat, /total sugars?/, 'g');
  const sugar = take('Sugar', sugarTotal ?? grab(flat, /(?<!added\s|incl\.?\s)\bsugars?\b/, 'g'));
  const protein = take('Protein', grab(flat, /\bprotein\b/, 'g'));

  let sodium: number | null = null;
  const sod = /sodium[^\d<]{0,24}?\s*(<\s*)?(\d+(?:[.,]\d+)?)\s*(mg|g)\b/.exec(flat);
  if (sod) {
    const v = Number(sod[2]!.replace(',', '.'));
    sodium = sod[1] ? 0 : sod[3] === 'g' ? v * 1000 : v;
  } else {
    const salt = /\bsalt[^\d<]{0,24}?\s*(\d+(?:[.,]\d+)?)\s*g\b/.exec(flat);
    if (salt) {
      sodium = Math.round(Number(salt[1]!.replace(',', '.')) * 400); // salt g × 0.4 = sodium g
      warnings.push('Sodium calculated from salt (salt × 0.4).');
    }
  }

  for (const [label, v] of [['Calories', kcal], ['Protein', protein], ['Carbs', carbs], ['Fat', fat]] as const) {
    if (v == null) warnings.push(`${label} not found — please enter it.`);
  }
  if (basis === 'serving' && servingGrams == null) warnings.push('Serving size in grams not found — please enter it.');

  if (kcal != null && protein != null && carbs != null && fat != null && kcal > 20) {
    const implied = 4 * protein + 4 * carbs + 9 * fat;
    if (Math.abs(implied - kcal) / kcal > 0.25) {
      warnings.push(`Calories (${kcal}) don't match the macros (~${Math.round(implied)}). Double-check the numbers.`);
    }
  }

  return { basis, servingText, servingGrams, kcal, protein_g: protein, carbs_g: carbs, fat_g: fat, fiber_g: fiber, sugar_g: sugar, sodium_mg: sodium, warnings };
}
