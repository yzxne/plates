import { useEffect, useRef, useState } from 'preact/hooks';
import { checkTypedCode } from '../../../shared/barcode';
import { showToast } from '../toast';

type Decoder = typeof import('../barcode/decoder');

interface Props {
  onCode: (code: string) => void;
}

const SCAN_EVERY_MS = 150;

/** Live camera scanning, with photo and typed-digits fallbacks. */
export function BarcodeScanner({ onCode }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<'loading' | 'scanning' | 'error'>('loading');
  const [error, setError] = useState('');
  const [torch, setTorch] = useState<boolean | null>(null); // null = not supported
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const [typedError, setTypedError] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const stream = useRef<MediaStream | null>(null);
  const decoder = useRef<Decoder | null>(null);
  const done = useRef(false);

  function stop() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }

  function found(code: string) {
    if (done.current) return;
    done.current = true;
    stop();
    navigator.vibrate?.(40); // works on Android; iPhone Safari ignores it
    onCode(code);
  }

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    async function tick() {
      if (cancelled || done.current) return;
      const v = video.current;
      if (v && ctx && v.readyState >= 2 && v.videoWidth) {
        // Decode the middle band of the frame, where the guide box is.
        const w = v.videoWidth;
        const h = v.videoHeight;
        const cw = Math.round(w * 0.9);
        const ch = Math.round(h * 0.5);
        canvas.width = cw;
        canvas.height = ch;
        ctx.drawImage(v, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, cw, ch);
        try {
          const code = await decoder.current!.decodeFrame(ctx.getImageData(0, 0, cw, ch));
          if (code) { found(code); return; }
        } catch { /* keep scanning */ }
      }
      timer = setTimeout(tick, SCAN_EVERY_MS);
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('error');
        setError('This browser has no camera access. Use a photo or type the number.');
        return;
      }
      try {
        const [d, s] = await Promise.all([
          import('../barcode/decoder'),
          navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          }),
        ]);
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        decoder.current = d;
        stream.current = s;
        const v = video.current!;
        v.srcObject = s;
        await v.play().catch(() => {});
        const track = s.getVideoTracks()[0];
        const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
        setTorch(caps.torch ? false : null);
        setStatus('scanning');
        void tick();
      } catch (err) {
        const name = (err as DOMException)?.name;
        setStatus('error');
        setError(
          name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow it in Settings → Safari → Camera (or tap "aA" → Website Settings), then try again. You can also use a photo or type the number.'
            : name === 'NotFoundError'
              ? 'No camera found. Use a photo or type the number.'
              : 'The camera could not start. Use a photo or type the number.',
        );
      }
    }

    const onHide = () => { if (document.visibilityState === 'hidden') stop(); };
    document.addEventListener('visibilitychange', onHide);
    void start();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onHide);
      stop();
    };
  }, []);

  async function toggleTorch() {
    const track = stream.current?.getVideoTracks()[0];
    if (!track || torch === null) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch {
      setTorch(null);
    }
  }

  async function onPhoto(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    (e.currentTarget as HTMLInputElement).value = '';
    if (!file) return;
    setPhotoBusy(true);
    try {
      const d = decoder.current ?? (await import('../barcode/decoder'));
      decoder.current = d;
      const code = await d.decodePhoto(file);
      if (code) found(code);
      else showToast("Couldn't find a barcode in that photo. Get closer, keep it flat and in focus, or type the number.", 'error', 6000);
    } catch {
      showToast("Couldn't read that photo.", 'error');
    } finally {
      setPhotoBusy(false);
    }
  }

  function submitTyped(e: Event) {
    e.preventDefault();
    const c = checkTypedCode(typed);
    if (!c.ok) { setTypedError(c.message); return; }
    found(c.code);
  }

  return (
    <div class="scanner">
      <div class="viewfinder">
        <video ref={video} playsInline muted autoPlay aria-label="Camera preview" />
        {status === 'scanning' && <div class="guide" aria-hidden="true"><span /></div>}
        {status === 'loading' && <p class="vf-msg">Starting camera…</p>}
        {status === 'error' && <p class="vf-msg error">{error}</p>}
      </div>
      {status === 'scanning' && <p class="muted center">Hold the barcode inside the box.</p>}

      <div class="btn-row">
        <label class={`btn ${photoBusy ? 'disabled' : ''}`}>
          {photoBusy ? 'Reading…' : 'Use a photo'}
          <input type="file" accept="image/*" capture="environment" class="visually-hidden" onChange={onPhoto} disabled={photoBusy} />
        </label>
        <button class="btn" onClick={() => setTyping(!typing)}>Type number</button>
        {torch !== null && <button class="btn" aria-pressed={torch} onClick={toggleTorch}>{torch ? 'Light off' : 'Light'}</button>}
      </div>

      {typing && (
        <form class="card form" onSubmit={submitTyped}>
          <div class="field">
            <label for="typed-code">Digits under the barcode</label>
            <input id="typed-code" inputMode="numeric" autocomplete="off" value={typed}
              onInput={(e) => { setTyped(e.currentTarget.value); setTypedError(''); }} />
            {typedError && <small class="error">{typedError}</small>}
          </div>
          <button class="btn primary" type="submit">Look up</button>
        </form>
      )}
    </div>
  );
}
