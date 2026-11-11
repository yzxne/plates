// Loaded only when you open the scanner (keeps the ~1 MB decoder out of the main app).
// The .wasm file is served from our own site, never a CDN.
import { prepareZXingModule, readBarcodes, type ReaderOptions } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { hasValidCheckDigit } from '../../../shared/barcode';

prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
  },
});

const LIVE: ReaderOptions = {
  formats: ['EAN13', 'EAN8', 'UPCA', 'UPCE'],
  tryHarder: true,
  tryRotate: true, // iOS 26 Home Screen apps may deliver rotated frames
  tryInvert: false,
  maxNumberOfSymbols: 1,
};

const PHOTO: ReaderOptions = { ...LIVE, tryDownscale: true, tryInvert: true };

function pick(results: { text: string; isValid: boolean }[]): string | null {
  for (const r of results) {
    const code = r.text.replace(/\D/g, '');
    if (r.isValid && hasValidCheckDigit(code)) return code;
  }
  return null;
}

export async function decodeFrame(image: ImageData): Promise<string | null> {
  return pick(await readBarcodes(image, LIVE));
}

export async function decodePhoto(file: Blob): Promise<string | null> {
  return pick(await readBarcodes(file, PHOTO));
}
