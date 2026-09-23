// 지금 재생 중인 곡 제목 줄. main.js가 미디어 헬퍼(native/media)에서 받은 정보를 넘겨 준다.
// 칸보다 길면 좌우로 천천히 흘러가며 보여 준다.
const NowPlaying = (() => {
  const SCROLL_PX_PER_SEC = 30;

  function create(boxEl, textEl) {
    function fitScroll() {
      boxEl.classList.remove('scroll');
      const overflow = textEl.scrollWidth - boxEl.clientWidth;
      if (overflow > 0) {
        boxEl.style.setProperty('--scroll-distance', `${-overflow}px`);
        boxEl.style.setProperty('--scroll-duration', `${Math.max(4, overflow / SCROLL_PX_PER_SEC)}s`);
        boxEl.classList.add('scroll');
      }
    }

    function show(info) {
      if (!info || !info.playing || !info.title) {
        boxEl.hidden = true;
        return;
      }
      const text = info.artist ? `♪ ${info.title} · ${info.artist}` : `♪ ${info.title}`;
      boxEl.hidden = false;
      boxEl.title = text;
      if (textEl.textContent !== text) {
        textEl.textContent = text;
        fitScroll();
      }
    }

    return { show };
  }

  return { create };
})();
