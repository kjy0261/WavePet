// 소리를 AnalyserNode로 넘긴다. 입력은 두 가지:
//  - 'all': 시스템 오디오 루프백(스피커로 나가는 소리 전체). main.js의
//    setDisplayMediaRequestHandler가 getDisplayMedia 요청에 audio: 'loopback'으로 응답한다.
//  - 'exclude': main.js가 띄운 네이티브 헬퍼(native/loopback)가 Discord 소리만 뺀 PCM을
//    IPC로 보내 주고, pcm-worklet.js가 그것을 그래프에 흘려 보낸다.
//
// 출력 장치가 바뀌면(스피커 → 이어폰/블루투스 등) 기존 캡처가 끊기거나 이전
// 장치를 계속 잡고 있으므로, 장치 변경 / 트랙 종료 시 자동으로 다시 연결한다.
const AudioInput = (() => {
  const FFT_SIZE = 2048;
  const HELPER_SAMPLE_RATE = 48000;
  const RETRY_DELAY_MS = 3000;
  const DEVICE_CHANGE_DELAY_MS = 800; // 장치 전환 직후 Windows 기본 출력이 바뀔 시간을 줌

  function create({ onStatus = () => {}, restartHelper = () => {} } = {}) {
    let source = 'all';
    let stream = null;
    let audioCtx = null;
    let analyser = null;
    let pcmNode = null;
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
      pcmNode = null;
    }

    function scheduleRestart(delayMs) {
      if (!running) return;
      clearTimeout(restartTimer);
      restartTimer = setTimeout(connect, delayMs);
    }

    function createAnalyser(ctx) {
      const node = ctx.createAnalyser();
      node.fftSize = FFT_SIZE;
      node.smoothingTimeConstant = 0.35; // 낮을수록 빠르게 반응
      node.minDecibels = -85;
      node.maxDecibels = -20;
      return node;
    }

    async function connectLoopback(seq) {
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
      analyser = createAnalyser(audioCtx);
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      freqBuf = new Uint8Array(analyser.frequencyBinCount);

      console.log('[wavepet] 오디오 연결됨(전체 소리):', audioTrack.label);
      onStatus('connected');
    }

    async function connectHelper(seq) {
      const ctx = new AudioContext({ sampleRate: HELPER_SAMPLE_RATE });
      try {
        await ctx.audioWorklet.addModule('pcm-worklet.js');
      } catch (err) {
        console.error('[wavepet] PCM 워클릿 로드 실패:', err);
        ctx.close().catch(() => {});
        onStatus('error');
        return;
      }
      if (seq !== startSeq || !running) {
        ctx.close().catch(() => {});
        return;
      }

      audioCtx = ctx;
      pcmNode = new AudioWorkletNode(ctx, 'pcm-player', { outputChannelCount: [1] });
      analyser = createAnalyser(ctx);
      // 그래프가 계속 처리되도록 destination까지 잇되, 소리는 내지 않는다.
      const mute = ctx.createGain();
      mute.gain.value = 0;
      pcmNode.connect(analyser).connect(mute).connect(ctx.destination);
      freqBuf = new Uint8Array(analyser.frequencyBinCount);

      console.log('[wavepet] 오디오 연결됨(헬퍼: Discord 제외)');
      onStatus('connected');
    }

    function connect() {
      const seq = ++startSeq;
      teardown();
      onStatus('connecting');
      if (source === 'exclude') connectHelper(seq);
      else connectLoopback(seq);
    }

    navigator.mediaDevices.addEventListener('devicechange', () => {
      console.log('[wavepet] 오디오 장치 변경 감지, 다시 연결');
      if (source === 'exclude') restartHelper();
      else scheduleRestart(DEVICE_CHANGE_DELAY_MS);
    });

    return {
      start(initialSource) {
        if (running) return;
        source = initialSource || source;
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
      setSource(newSource) {
        if (newSource === source) return;
        source = newSource;
        scheduleRestart(0);
      },
      reconnect() {
        if (source === 'exclude') restartHelper();
        scheduleRestart(0);
      },
      // 헬퍼가 보낸 f32 PCM 바이트
      pushPcm(bytes) {
        if (!pcmNode) return;
        // IPC로 온 Uint8Array는 4바이트 정렬이 보장되지 않아 복사해서 Float32Array로 만든다.
        const samples = new Float32Array(bytes.slice().buffer);
        pcmNode.port.postMessage(samples, [samples.buffer]);
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
