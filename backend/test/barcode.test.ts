import { describe, expect, it } from 'vitest';
import { checkTypedCode, gtinKey, hasValidCheckDigit, lookupCode, sameProduct, upcEToUpcA } from '../../shared/barcode';

describe('barcode helpers', () => {
  it('validates GTIN check digits', () => {
    expect(hasValidCheckDigit('3017624010701')).toBe(true); // EAN-13 (Nutella, from Phase 0 test)
    expect(hasValidCheckDigit('016000275287')).toBe(true); // UPC-A (Cheerios)
    expect(hasValidCheckDigit('00016000275287')).toBe(true); // GTIN-14 as USDA stores it
    expect(hasValidCheckDigit('96385074')).toBe(true); // EAN-8
    expect(hasValidCheckDigit('3017624010702')).toBe(false);
    expect(hasValidCheckDigit('12345')).toBe(false);
  });

  it('expands UPC-E to UPC-A', () => {
    expect(upcEToUpcA('04252614')).toBe('042100005264');
    expect(upcEToUpcA('01234565')).toBe('012345000065');
    expect(upcEToUpcA('99999999')).toBeNull();
  });

  it('matches the same product across UPC-A / EAN-13 / GTIN-14 / UPC-E', () => {
    expect(sameProduct('016000275287', '00016000275287')).toBe(true);
    expect(sameProduct('0016000275287', '016000275287')).toBe(true);
    expect(sameProduct('04252614', '042100005264')).toBe(true);
    expect(sameProduct('016000275287', '3017624010701')).toBe(false);
    expect(sameProduct('', '0')).toBe(false);
    expect(gtinKey('00016000275287')).toBe('16000275287');
  });

  it('builds the code to look up on Open Food Facts', () => {
    expect(lookupCode('016000275287')).toBe('0016000275287');
    expect(lookupCode('3017624010701')).toBe('3017624010701');
    expect(lookupCode('00016000275287')).toBe('0016000275287');
    expect(lookupCode('04252614')).toBe('0042100005264');
  });

  it('checks typed digits', () => {
    expect(checkTypedCode('3017 6240 1070 1')).toEqual({ ok: true, code: '3017624010701', message: '' });
    expect(checkTypedCode('301762401070').ok).toBe(false);
    expect(checkTypedCode('3017624010709').message).toMatch(/check digit/);
  });
});
