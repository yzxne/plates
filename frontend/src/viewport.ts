// iPhone keyboard handling.
// 1. --kb = how much of the screen the keyboard covers, so bars pinned to the bottom (rest timer) can sit above it.
// 2. When the keyboard closes, iOS can leave the page shifted, which makes the top (or bottom) unreachable.
//    Put it back: no page scroll while a full-screen panel is open, otherwise just re-apply the scroll.
export function installViewportFix() {
  const vv = window.visualViewport;
  const root = document.documentElement;
  const update = () => {
    const kb = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    root.style.setProperty('--kb', `${kb > 80 ? Math.round(kb) : 0}px`);
  };
  vv?.addEventListener('resize', update);
  vv?.addEventListener('scroll', update);
  update();

  document.addEventListener('focusout', () => {
    setTimeout(() => {
      const a = document.activeElement;
      if (a && a.matches('input, textarea, select')) return; // moved to another field
      if (document.querySelector('.overlay')) window.scrollTo(0, 0);
      else window.scrollTo(window.scrollX, Math.min(window.scrollY, root.scrollHeight - window.innerHeight));
      update();
    }, 120);
  });
}
