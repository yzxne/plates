// Grey placeholder shapes shown while data loads, so screens don't jump when it arrives.

/** One card with a title bar and `lines` text bars. */
export function SkeletonCard({ lines = 3, tall = false }: { lines?: number; tall?: boolean }) {
  return (
    <div class="card skel-card" aria-hidden="true">
      <span class="skel skel-title" />
      {tall && <span class="skel skel-block" />}
      {Array.from({ length: lines }, (_, i) => <span key={i} class="skel skel-line" style={{ width: `${88 - i * 14}%` }} />)}
    </div>
  );
}

/** A screen's worth of placeholders: optional page title + `cards` cards. */
export function SkeletonScreen({ title, cards = 3 }: { title?: string; cards?: number }) {
  return (
    <section aria-busy="true" aria-label="Loading">
      {title && <header class="screen-head"><h1>{title}</h1></header>}
      <SkeletonCard tall lines={2} />
      {Array.from({ length: cards - 1 }, (_, i) => <SkeletonCard key={i} lines={3} />)}
    </section>
  );
}

/** Rows inside a list card (recent foods, saved foods, backups…). */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div class="list card" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} class="row skel-row"><span class="skel skel-line" style={{ width: `${70 - i * 10}%` }} /><span class="skel skel-dot" /></div>
      ))}
    </div>
  );
}
