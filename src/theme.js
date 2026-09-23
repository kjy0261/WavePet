// 배경 색/투명도를 위젯에 적용한다. {color: '#rrggbb', opacity: 0~1}
// 밝은 배경이면 글자·아이콘·파형을 어두운 색으로 바꿔(body.light) 계속 잘 보이게 한다.
const Theme = (() => {
  const LIGHT_TEXT = '#ffffff';
  const DARK_TEXT = '#1d2129';

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // 0 = 검정, 1 = 흰색 (sRGB 상대 휘도)
  function luminance([r, g, b]) {
    const lin = (c) => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  // amount > 0 이면 흰색 쪽으로, < 0 이면 검정 쪽으로 섞는다
  function shade([r, g, b], amount) {
    const target = amount > 0 ? 255 : 0;
    const t = Math.abs(amount);
    return [r, g, b].map((c) => Math.round(c + (target - c) * t));
  }

  function rgba(rgb, alpha) {
    return `rgba(${rgb.join(', ')}, ${alpha})`;
  }

  // 적용한 글자색(파형 색으로도 씀)을 돌려준다
  function apply({ color, opacity }) {
    const base = hexToRgb(color);
    const root = document.documentElement.style;
    // 유리 느낌: 왼쪽 위는 조금 밝게, 오른쪽 아래는 조금 어둡게
    root.setProperty('--bg-top', rgba(shade(base, 0.15), opacity));
    root.setProperty('--bg-bottom', rgba(shade(base, -0.25), Math.min(1, opacity + 0.04)));
    const light = luminance(base) > 0.45;
    document.body.classList.toggle('light', light);
    const fg = light ? DARK_TEXT : LIGHT_TEXT;
    root.setProperty('--fg', fg);
    return fg;
  }

  return { apply };
})();
