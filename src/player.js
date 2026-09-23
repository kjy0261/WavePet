// 음악 플레이어 카드: 곡 제목/아티스트, 진행 바와 시간, 이전/재생·일시정지/다음 버튼.
// main.js가 미디어 헬퍼(native/media)에서 받은 정보를 넘겨 주고, 버튼을 누르면
// onCommand('prev' | 'toggle' | 'next')로 헬퍼에 명령을 보낸다.
const Player = (() => {
  const SCROLL_PX_PER_SEC = 30;
  const TICK_MS = 250;
  const EMPTY_TITLE = '재생 중인 음악 없음';

  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const total = Math.floor(sec);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  function create(el, { onCommand }) {
    let info = { has: false };
    let receivedAt = 0; // info를 받은 시각. 재생 중이면 이후 흐른 시간만큼 위치를 앞으로 보정

    function fitMarquee(box) {
      const text = box.firstElementChild;
      box.classList.remove('scroll');
      const overflow = text.scrollWidth - box.clientWidth;
      if (overflow > 0) {
        box.style.setProperty('--scroll-distance', `${-overflow}px`);
        box.style.setProperty('--scroll-duration', `${Math.max(4, overflow / SCROLL_PX_PER_SEC)}s`);
        box.classList.add('scroll');
      }
    }

    function tick() {
      let position = info.position || 0;
      if (info.playing) position += (performance.now() - receivedAt) / 1000;
      const duration = info.duration || 0;
      if (duration > 0) position = Math.min(position, duration);
      el.barFill.style.width = duration > 0 ? `${(position / duration) * 100}%` : '0';
      el.timeNow.textContent = info.has ? formatTime(position) : '0:00';
      el.timeTotal.textContent = duration > 0 ? formatTime(duration) : info.has ? '--:--' : '0:00';
    }

    function show(next) {
      info = next && next.has ? next : { has: false };
      receivedAt = performance.now();

      const title = info.has ? info.title : EMPTY_TITLE;
      el.title.classList.toggle('empty', !info.has);
      if (el.titleText.textContent !== title) {
        el.titleText.textContent = title;
        el.title.title = title;
        fitMarquee(el.title);
      }
      el.artist.textContent = info.has ? info.artist || '' : '';
      el.toggle.classList.toggle('playing', !!info.playing);
      for (const button of [el.prev, el.toggle, el.next]) button.disabled = !info.has;
      tick();
    }

    el.prev.addEventListener('click', () => onCommand('prev'));
    el.next.addEventListener('click', () => onCommand('next'));
    el.toggle.addEventListener('click', () => {
      // 응답이 오기 전에 아이콘을 먼저 바꿔 눌렀다는 느낌을 준다 (곧 실제 상태로 덮어씀)
      el.toggle.classList.toggle('playing');
      onCommand('toggle');
    });

    setInterval(tick, TICK_MS);
    show(info);
    return { show };
  }

  return { create };
})();
