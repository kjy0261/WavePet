// FFT 주파수 데이터를 막대 높이(0~1) 배열로 바꾼다.
//  - 로그 스케일 대역: 저음 쪽에 막대가 몰리지 않게
//  - 한 줄 배치: 왼쪽이 저음, 오른쪽이 고음
//  - 자동 게인: 최근 최대값으로 나눠 조용한 곡도 적당히 움직이게
//  - 대비: 최대값 대비 CONTRAST_CUT 아래는 잘라 내서, 두드러진 대역만 길게 솟게
//    (주파수 값이 dB 단위라 그대로 쓰면 대부분 막대가 비슷하게 높아 꽉 차 보임)
//  - attack/release 보간: 올라갈 땐 빠르게, 내려갈 땐 그보다 느리게 (지글거림 방지)
const Spectrum = (() => {
  const MIN_HZ = 40;
  const MAX_HZ = 14000;
  const ATTACK = 0.6;
  const RELEASE = 0.22; // 클수록 빨리 내려와 막대가 높은 채로 머물지 않음
  const GAIN_DECAY = 0.996; // 최대값 기준을 천천히 낮춤(프레임당)
  const GAIN_FLOOR = 0.35; // 무음/아주 작은 소리를 과하게 키우지 않게
  const HIGH_TILT = 0.8; // 고음 대역이 약하게 나와 오른쪽이 늘 짧아지는 걸 보정
  const CONTRAST_CUT = 0.5; // 최대값의 이 비율 이하인 대역은 최소 높이로
  const CONTRAST_CURVE = 1.3; // 1보다 크면 중간 높이를 더 눌러 대비를 키움
  const HEADROOM = 0.92; // 가장 큰 막대도 끝까지 닿지 않게 살짝 여유

  function create(barCount) {
    const levels = new Float32Array(barCount);
    const raw = new Float32Array(barCount);
    let peak = GAIN_FLOOR;

    function bandRange(k, binHz, binCount) {
      const lo = MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, k / barCount);
      const hi = MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, (k + 1) / barCount);
      const from = Math.min(binCount - 1, Math.max(1, Math.floor(lo / binHz)));
      const to = Math.min(binCount, Math.max(from + 1, Math.ceil(hi / binHz)));
      return [from, to];
    }

    // freq: 0~255 바이트 배열 또는 null(무음/연결 전)
    function update(freq, binHz) {
      let frameMax = 0;
      for (let k = 0; k < barCount; k++) {
        let v = 0;
        if (freq && binHz > 0) {
          const [from, to] = bandRange(k, binHz, freq.length);
          let sum = 0;
          let max = 0;
          for (let b = from; b < to; b++) {
            sum += freq[b];
            if (freq[b] > max) max = freq[b];
          }
          // 평균과 최대의 중간값: 평균만 쓰면 뭉개지고, 최대만 쓰면 튐
          v = ((sum / (to - from)) * 0.5 + max * 0.5) / 255;
          v *= 1 + HIGH_TILT * (k / barCount);
        }
        raw[k] = v;
        if (v > frameMax) frameMax = v;
      }

      peak = Math.max(GAIN_FLOOR, frameMax, peak * GAIN_DECAY);

      for (let i = 0; i < barCount; i++) {
        const rel = Math.max(0, (raw[i] / peak - CONTRAST_CUT) / (1 - CONTRAST_CUT));
        const target = Math.min(1, Math.pow(rel, CONTRAST_CURVE) * HEADROOM);
        const rate = target > levels[i] ? ATTACK : RELEASE;
        levels[i] += (target - levels[i]) * rate;
      }
      return levels;
    }

    return { update };
  }

  return { create };
})();
