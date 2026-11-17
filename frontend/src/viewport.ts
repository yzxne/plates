// iPhone keyboard handling.
// 1. --kb = how much of the screen the keyboard covers, so bars pinned to the bottom (rest timer) can sit above it.
// 2. When the keyboard closes, iOS can leave the page shifted, which makes the top (or bottom) unreachable.
//    Put it back: no page scroll while a full-screen panel is open, otherwise just re-apply the scroll.
export function installViewportFix() {
  const vv = window.visualViewport;
  const root = document.documentElement;
  // Only while a text field is focused: iOS can report a shrunken/shifted viewport with no keyboard
  // (toolbar changes, zoom, a stale value after the keyboard closes), which left the timer floating mid-screen.
  const typing = () => { const a = document.activeElement; return !!a && a.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea'); };
  const update = () => {
    const kb = vv && typing() ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    root.style.setProperty('--kb', `${kb > 80 ? Math.round(kb) : 0}px`);
  };
  vv?.addEventListener('resize', update);
  vv?.addEventListener('scroll', update);
  document.addEventListener('focusin', () => setTimeout(update, 300)); // after the keyboard has opened
  update();

  document.addEventListener('focusout', () => {
    setTimeout(() => {
      const a = document.activeElement;
      if (a && a.matches('input, textarea, select')) { update(); return; } // moved to another field
      if (document.querySelector('.overlay')) window.scrollTo(0, 0);
      else window.scrollTo(window.scrollX, Math.min(window.scrollY, root.scrollHeight - window.innerHeight));
      update();
    }, 120);
  });
}
