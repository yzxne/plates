import { chicagoDate } from '../../../shared/schema';

export function Placeholder({ title, phase, text }: { title: string; phase: number; text: string }) {
  const today = new Date(chicagoDate() + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  return (
    <section>
      <header class="screen-head">
        <h1>{title}</h1>
        <p class="muted">{today}</p>
      </header>
      <div class="card empty">
        <p>{text}</p>
        <small class="muted">Arrives in Phase {phase}.</small>
      </div>
    </section>
  );
}
