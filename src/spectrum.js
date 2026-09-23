// FFT 주파수 데이터를 막대 높이(0~1) 배열로 바꾼다.
//  - 로그 스케일 대역: 저음 쪽에 막대가 몰리지 않게
//  - 가운데에서 바깥으로 배치: 저음이 가운데, 고음이 양옆이라 가운데가 불룩한 모양.
//    대역을 좌/우에 번갈아 놓아 완전한 좌우 대칭은 피한다.
//  - 자동 게인: 최근 최대값으로 나눠 조용한 곡도 적당히 움직이게
//  - attack/release 보간: 올라갈 땐 빠르게, 내려갈 땐 천천히 (지글거림 방지)
const Spectrum = (() => {
  const MIN_HZ = 40;
  const MAX_HZ = 14000;
  const ATTACK = 0.55;
  const RELEASE = 0.12;
  const GAIN_DECAY = 0.996; // 최대값 기준을 천천히 낮춤(프레임당)
  const GAIN_FLOOR = 0.35; // 무음/아주 작은 소리를 과하게 키우지 않게
  const HIGH_TILT = 0.5; // 고음 대역이 약하게 나오는 걸 보정

  function create(barCount) {
    const levels = new Float32Array(barCount);
    const raw = new Float32Array(barCount);
    let peak = GAIN_FLOOR;

    // 대역 k(0 = 최저음)를 그릴 위치: 가운데부터 좌우로 번갈아
    const position = new Array(barCount);
    let left = Math.floor(barCount / 2) - 1;
    let right = left + 1;
    for (let k = 0; k < barCount; k++) {
      const goLeft = (k % 2 === 0 && left >= 0) || right >= barCount;
      position[k] = goLeft ? left-- : right++;
    }

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
        raw[position[k]] = v;
        if (v > frameMax) frameMax = v;
      }

      peak = Math.max(GAIN_FLOOR, frameMax, peak * GAIN_DECAY);

      for (let i = 0; i < barCount; i++) {
        const target = Math.min(1, Math.pow(raw[i] / peak, 1.6)); // 대비를 살짝 키움
        const rate = target > levels[i] ? ATTACK : RELEASE;
        levels[i] += (target - levels[i]) * rate;
      }
      return levels;
    }

    return { update };
  }

  return { create };
})();
