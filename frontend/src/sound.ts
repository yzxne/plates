// Rest-timer alert. iPhone Safari only allows sound after a tap, so unlockAudio() is
// called when you check off a set; the alert plays when the timer ends.
//
// Sound: a soft three-note chime (C–E–G an octave above middle C's octave, like a doorbell/marimba):
// sine tones with a quiet overtone, gentle attack and a ringing fade. Mid-range pitches still carry
// on a phone speaker without the piercing edge of the old 2–3 kHz square-wave beeps.
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
      tone.frequency.value = 4000;
      tone.connect(comp).connect(ctx.destination);
      out = tone;
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { /* no audio */ }
}

/** One bell-like note: sine + a quiet octave overtone, 15 ms fade-in, ringing decay. */
function chime(at: number, freq: number, length: number, level = 0.55): void {
  if (!ctx || !out) return;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(level, at + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  gain.connect(out);
  for (const [mult, amp] of [[1, 1], [2, 0.18]] as const) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq * mult;
    g.gain.value = amp;
    osc.connect(g).connect(gain);
    osc.start(at);
    osc.stop(at + length + 0.05);
  }
}

/** Rising C6–E6–G6 chime, played twice (~1.6 s). */
export function beep(): void {
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime + 0.03;
    for (const rep of [0, 0.85]) {
      chime(t0 + rep, 1047, 0.7);
      chime(t0 + rep + 0.16, 1319, 0.7);
      chime(t0 + rep + 0.32, 1568, 0.8);
    }
  } catch { /* ignore */ }
  navigator.vibrate?.([150, 100, 150]);
}
