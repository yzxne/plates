// Short beeps for the rest timer. iPhone Safari only allows sound after a tap, so
// unlockAudio() is called when you check off a set; the beep plays when the timer ends.
// Vibration isn't available in iPhone Safari (documented limitation).

let ctx: AudioContext | null = null;

export function unlockAudio(): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { /* no audio */ }
}

export function beep(times = 3): void {
  if (!ctx) return;
  try {
    const start = ctx.currentTime + 0.02;
    for (let i = 0; i < times; i++) {
      const t = start + i * 0.28;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = i === times - 1 ? 1175 : 880;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.22);
    }
  } catch { /* ignore */ }
  navigator.vibrate?.([120, 80, 120]);
}
