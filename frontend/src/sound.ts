// Rest-timer alert. iPhone Safari only allows sound after a tap, so unlockAudio() is
// called when you check off a set; the alert plays when the timer ends.
//
// Loudness: full-scale square wave at ~2.3 kHz (where phone speakers and ears are most
// sensitive), through a compressor so it stays loud without clipping.
// Volume follows the iPhone's media volume. Web audio is muted by the silent switch
// (default "ambient" audio session, which mixes with your music instead of pausing it).
// Vibration isn't available in iPhone Safari (documented limitation).

let ctx: AudioContext | null = null;
let out: AudioNode | null = null;

export function unlockAudio(): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!ctx) {
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.knee.value = 6;
      comp.ratio.value = 8;
      comp.attack.value = 0.002;
      comp.release.value = 0.1;
      const tone = ctx.createBiquadFilter(); // takes the harsh edge off the square wave
      tone.type = 'lowpass';
      tone.frequency.value = 7000;
      tone.connect(comp).connect(ctx.destination);
      out = tone;
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { /* no audio */ }
}

function burst(at: number, freq: number, length: number): void {
  if (!ctx || !out) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(1, at + 0.008);
  gain.gain.setValueAtTime(1, at + length - 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + length + 0.02);
}

/** Three pairs of high/low beeps (~1.5 s). */
export function beep(): void {
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime + 0.03;
    for (let i = 0; i < 3; i++) {
      const t = t0 + i * 0.5;
      burst(t, 2300, 0.16);
      burst(t + 0.2, 2900, 0.16);
    }
  } catch { /* ignore */ }
  navigator.vibrate?.([150, 100, 150]);
}
