// Barcode helpers. Retail barcodes are GTINs (8, 12, 13 or 14 digits) with a mod-10 check digit.
// The same product can appear as UPC-A (12), EAN-13 (leading 0) or GTIN-14 (leading 00) in different databases.

export function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

/** True if the last digit is the correct GTIN check digit. */
export function hasValidCheckDigit(code: string): boolean {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  let sum = 0;
  // From the right (excluding the check digit): weights 3,1,3,1,...
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += digits[i]! * w;
  return (10 - (sum % 10)) % 10 === check;
}

/** Expands a UPC-E (8 digits, number system 0/1) to its UPC-A form. Returns null if not UPC-E. */
export function upcEToUpcA(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const ns = code[0]!;
  const d = code.slice(1, 7);
  const check = code[7]!;
  const last = d[5]!;
  let body: string;
  if ('012'.includes(last)) body = d.slice(0, 2) + last + '0000' + d.slice(2, 5);
  else if (last === '3') body = d.slice(0, 3) + '00000' + d.slice(3, 5);
  else if (last === '4') body = d.slice(0, 4) + '00000' + d[4];
  else body = d.slice(0, 5) + '0000' + last;
  const upca = ns + body + check;
  return hasValidCheckDigit(upca) ? upca : null;
}

/** Canonical comparable form: leading zeros removed (so UPC-A, EAN-13 and GTIN-14 match). */
export function gtinKey(code: string): string {
  const d = digitsOnly(code);
  return d.replace(/^0+/, '') || '0';
}

export function sameProduct(a: string, b: string): boolean {
  if (!a || !b) return false;
  const keys = (c: string) => {
    const d = digitsOnly(c);
    const out = [gtinKey(d)];
    const e = d.length === 8 ? upcEToUpcA(d) : null;
    if (e) out.push(gtinKey(e));
    return out;
  };
  const ka = keys(a);
  return keys(b).some((k) => ka.includes(k));
}

/** Code to send to Open Food Facts: EAN-13 for 12-digit UPC-A, as-is otherwise. */
export function lookupCode(code: string): string {
  const d = digitsOnly(code);
  if (d.length === 8) {
    const a = upcEToUpcA(d);
    if (a) return '0' + a;
  }
  if (d.length === 12) return '0' + d;
  if (d.length === 14 && d.startsWith('0')) return d.slice(1);
  return d;
}

export interface ManualCodeCheck { ok: boolean; code: string; message: string }

/** Validates digits typed by hand. */
export function checkTypedCode(input: string): ManualCodeCheck {
  const code = digitsOnly(input);
  if (![8, 12, 13, 14].includes(code.length)) {
    return { ok: false, code, message: 'Barcodes have 8, 12, 13 or 14 digits.' };
  }
  if (!hasValidCheckDigit(code)) {
    return { ok: false, code, message: "Those digits don't add up (check digit). Re-check the numbers under the bars." };
  }
  return { ok: true, code, message: '' };
}
