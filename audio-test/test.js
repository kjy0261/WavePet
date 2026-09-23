const startBtn = document.getElementById('start');
const stopBtn = document.getElementById('stop');
const statusEl = document.getElementById('status');
const tracksEl = document.getElementById('tracks');
const levelEl = document.getElementById('level');
const levelBar = document.getElementById('level-bar');
const canvas = document.getElementById('bars');
const ctx2d = canvas.getContext('2d');

const BAR_COUNT = 48;

let stream = null;
let audioCtx = null;
let rafId = null;

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

async function start() {
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch (err) {
    console.error('[audio-test] getDisplayMedia 실패:', err);
    setStatus(`캡처 실패: ${err.name} - ${err.message}`, true);
    return;
  }

  const audioTracks = stream.getAudioTracks();
  tracksEl.textContent = `${audioTracks.length}개 ${audioTracks[0] ? `(${audioTracks[0].label})` : ''}`;
  console.log('[audio-test] 오디오 트랙 수:', audioTracks.length, audioTracks[0]?.label);

  if (audioTracks.length === 0) {
    setStatus('오디오 트랙이 없습니다: 루프백 캡처가 잡히지 않았어요', true);
    stop();
    return;
  }

  audioCtx = new AudioContext();
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.6;
  audioCtx.createMediaStreamSource(stream).connect(analyser);

  const timeBuf = new Float32Array(analyser.fftSize);
  const freqBuf = new Uint8Array(analyser.frequencyBinCount);

  startBtn.disabled = true;
  stopBtn.disabled = false;
  setStatus('캡처 중: 소리에 맞춰 막대가 움직이는지 확인하세요');

  const tick = () => {
    // 음량(RMS)
    analyser.getFloatTimeDomainData(timeBuf);
    let sum = 0;
    for (const v of timeBuf) sum += v * v;
    const rms = Math.sqrt(sum / timeBuf.length);
    levelEl.textContent = rms.toFixed(4);
    levelBar.style.width = `${Math.min(rms * 400, 100)}%`;

    // 주파수 막대 미리보기(확인용 단순 버전: 로그 구간으로 묶기만 함)
    analyser.getByteFrequencyData(freqBuf);
    drawBars(freqBuf);

    rafId = requestAnimationFrame(tick);
  };
  tick();
}

function drawBars(freqBuf) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.clearRect(0, 0, w, h);
  ctx2d.fillStyle = '#ffffff';

  const bins = freqBuf.length;
  const slot = w / BAR_COUNT;
  const barW = Math.max(2, slot * 0.4);
  for (let i = 0; i < BAR_COUNT; i++) {
    // 저음 쪽이 몰리지 않도록 로그 스케일로 구간을 나눔
    const from = Math.floor(Math.pow(bins, i / BAR_COUNT));
    const to = Math.max(from + 1, Math.floor(Math.pow(bins, (i + 1) / BAR_COUNT)));
    let peak = 0;
    for (let b = from; b < to && b < bins; b++) peak = Math.max(peak, freqBuf[b]);
    const barH = Math.max(4, (peak / 255) * h);
    const x = i * slot + (slot - barW) / 2;
    ctx2d.beginPath();
    ctx2d.roundRect(x, (h - barH) / 2, barW, barH, barW / 2);
    ctx2d.fill();
  }
}

function stop() {
  cancelAnimationFrame(rafId);
  rafId = null;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  if (audioCtx) audioCtx.close();
  audioCtx = null;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  levelEl.textContent = '-';
  levelBar.style.width = '0';
  if (!statusEl.classList.contains('error')) setStatus('정지됨');
}

startBtn.addEventListener('click', start);
stopBtn.addEventListener('click', stop);
