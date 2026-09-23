// 주파수 데이터에서 "지금 소리가 나는지"(loudness)와 "박자가 왔는지"(beat)를 뽑는다.
//  - loudness: 8kHz 이하 전체 대역의 평균 크기를 부드럽게 한 값(0~1)
//  - beat: 저음(40~160Hz, 킥 드럼 대역)이 최근 평균보다 확 튀는 순간
const BeatDetector = (() => {
  const BASS_MIN_HZ = 40;
  const BASS_MAX_HZ = 160;
  const LOUD_MAX_HZ = 8000;
  const BEAT_JUMP = 0.07; // 최근 평균보다 이만큼 커야 박자로 봄 (dB 눈금 값 기준)
  const BEAT_MIN_BASS = 0.3; // 아주 작은 저음은 무시
  const BEAT_MIN_INTERVAL_MS = 260; // 연속으로 튀지 않게
  const BASS_AVG_RATE = 0.08; // 30fps에서 약 0.4초 평균

  function bandMean(freq, binHz, fromHz, toHz) {
    const from = Math.max(1, Math.floor(fromHz / binHz));
    const to = Math.min(freq.length, Math.max(from + 1, Math.ceil(toHz / binHz)));
    let sum = 0;
    for (let b = from; b < to; b++) sum += freq[b];
    return sum / (to - from) / 255;
  }

  function create() {
    let bassAvg = 0;
    let loudness = 0;
    let lastBeat = 0;

    function update(freq, binHz, now) {
      if (!freq || !binHz) {
        bassAvg *= 0.9;
        loudness *= 0.9;
        return { loudness, beat: false };
      }
      const bass = bandMean(freq, binHz, BASS_MIN_HZ, BASS_MAX_HZ);
      const overall = bandMean(freq, binHz, BASS_MIN_HZ, LOUD_MAX_HZ);
      loudness += (overall - loudness) * 0.2;

      const beat =
        bass > BEAT_MIN_BASS && bass - bassAvg > BEAT_JUMP && now - lastBeat > BEAT_MIN_INTERVAL_MS;
      if (beat) lastBeat = now;
      bassAvg += (bass - bassAvg) * BASS_AVG_RATE;
      return { loudness, beat };
    }

    return { update };
  }

  return { create };
})();
