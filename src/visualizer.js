// 세로 중앙 기준 위아래 대칭인 둥근 막대 파형을 캔버스에 그린다.
// levels: 0~1 사이 값 배열(막대 하나당 하나, spectrum.js가 만들어 줌).
const Visualizer = (() => {
  const MIN_BAR_RATIO = 0.05; // 무음일 때도 막대가 짧게 남아 위젯이 비어 보이지 않게
  const BAR_WIDTH_RATIO = 0.3; // 막대 폭 / 막대 한 칸 폭 (작을수록 가늘고 간격 넓음)

  function create(canvas, { color = '#ffffff' } = {}) {
    const ctx = canvas.getContext('2d');

    function fitToDisplay() {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w, h };
    }

    function draw(levels) {
      const { w, h } = fitToDisplay();
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = color;

      const slot = w / levels.length;
      const barW = Math.max(1.5, slot * BAR_WIDTH_RATIO);
      for (let i = 0; i < levels.length; i++) {
        const level = Math.max(MIN_BAR_RATIO, Math.min(1, levels[i]));
        const barH = level * h;
        const x = i * slot + (slot - barW) / 2;
        ctx.beginPath();
        ctx.roundRect(x, (h - barH) / 2, barW, barH, barW / 2);
        ctx.fill();
      }
    }

    return { draw };
  }

  return { create };
})();
