// 시스템 오디오 루프백(스피커로 나가는 소리)을 캡처해 AnalyserNode로 넘긴다.
// main.js의 setDisplayMediaRequestHandler가 getDisplayMedia 요청에
// 화면 + audio: 'loopback'으로 응답해 준다.
//
// 출력 장치가 바뀌면(스피커 → 이어폰/블루투스 등) 기존 캡처가 끊기거나 이전
// 장치를 계속 잡고 있으므로, 장치 변경 / 트랙 종료 시 자동으로 다시 연결한다.
const AudioInput = (() => {
  const FFT_SIZE = 2048;
  const RETRY_DELAY_MS = 3000;
  const DEVICE_CHANGE_DELAY_MS = 800; // 장치 전환 직후 Windows 기본 출력이 바뀔 시간을 줌

  function create({ onStatus = () => {} } = {}) {
    let stream = null;
    let audioCtx = null;
    let analyser = null;
    let freqBuf = null;
    let running = false;
    let restartTimer = null;
    let startSeq = 0; // 겹친 재연결 요청 중 마지막 것만 살리기 위한 번호

    function teardown() {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = null;
      if (audioCtx) audioCtx.close().catch(() => {});
      audioCtx = null;
      analyser = null;
    }

    function scheduleRestart(delayMs) {
      if (!running) return;
      clearTimeout(restartTimer);
      restartTimer = setTimeout(connect, delayMs);
    }

    async function connect() {
      const seq = ++startSeq;
      teardown();
      onStatus('connecting');

      let newStream;
      try {
        newStream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          // 영상은 필요 없지만 getDisplayMedia가 요구하므로 최소 해상도/프레임으로 받아
          // CPU 사용을 줄인다.
          video: { width: { max: 64 }, height: { max: 64 }, frameRate: { max: 1 } },
        });
      } catch (err) {
        console.error(`[wavepet] 오디오 캡처 실패: ${err.name} - ${err.message}`);
        onStatus('error');
        scheduleRestart(RETRY_DELAY_MS);
        return;
      }

      // 기다리는 사이 더 새로운 재연결이 시작됐거나 정지됐으면 이 스트림은 버림
      if (seq !== startSeq || !running) {
        newStream.getTracks().forEach((t) => t.stop());
        return;
      }

      const audioTrack = newStream.getAudioTracks()[0];
      if (!audioTrack) {
        console.error('[wavepet] 오디오 트랙이 없음: 루프백 캡처 미지원 환경일 수 있음');
        newStream.getTracks().forEach((t) => t.stop());
        onStatus('error');
        scheduleRestart(RETRY_DELAY_MS);
        return;
      }

      stream = newStream;
      audioTrack.addEventListener('ended', () => {
        console.warn('[wavepet] 오디오 트랙 종료됨, 다시 연결');
        scheduleRestart(DEVICE_CHANGE_DELAY_MS);
      });

      audioCtx = new AudioContext();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.5;
      analyser.minDecibels = -85;
      analyser.maxDecibels = -20;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      freqBuf = new Uint8Array(analyser.frequencyBinCount);

      console.log('[wavepet] 오디오 연결됨:', audioTrack.label);
      onStatus('connected');
    }

    navigator.mediaDevices.addEventListener('devicechange', () => {
      console.log('[wavepet] 오디오 장치 변경 감지, 다시 연결');
      scheduleRestart(DEVICE_CHANGE_DELAY_MS);
    });

    return {
      start() {
        if (running) return;
        running = true;
        connect();
      },
      stop() {
        running = false;
        clearTimeout(restartTimer);
        startSeq++;
        teardown();
        onStatus('stopped');
      },
      reconnect() {
        scheduleRestart(0);
      },
      // 0~255 바이트 주파수 데이터. 연결 전이면 null
      getFrequencyData() {
        if (!analyser) return null;
        analyser.getByteFrequencyData(freqBuf);
        return freqBuf;
      },
      get binHz() {
        return audioCtx ? audioCtx.sampleRate / FFT_SIZE : 0;
      },
    };
  }

  return { create };
})();
