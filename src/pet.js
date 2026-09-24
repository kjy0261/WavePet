// 캐릭터 상태와 연출
//  - idle: 가만히 ('노래 멈출 때' 그림)
//  - listening: 고개를 까딱까딱. 까딱할 때마다 left/right 그림을 번갈아 보여 주고 살짝 통통 튄다.
//    left/right 그림이 없으면 '노래 나올 때' 그림을 좌우로 기울여(#pet[data-tilt]) 대신한다.
//    까딱은 박자(킥 드럼)에 맞추되, 박자가 잘 안 잡히면 NOD_AUTO_MS 간격으로 알아서 한다.
//    몇 박자에 한 번 머리 위로 ♪가 떠오름
//
// 전환 기준
//  1) 재생 앱이 Windows 미디어 정보로 재생 상태를 알려 주면(setMediaPlaying) 그대로 따른다.
//     노래가 시작/정지되면 바로 바뀌고, 곡 중간의 조용한 부분에도 흔들리지 않는다.
//  2) 알려 주지 않으면(null) 소리 크기로 판단한다.
//     - idle → listening: 소리(loudness > LISTEN_ON)가 LISTEN_AFTER_MS 동안 이어질 때
//     - listening → idle: 조용함(loudness < QUIET_BELOW)이 IDLE_AFTER_MS 동안 이어질 때
//     - QUIET_BELOW를 LISTEN_ON보다 낮게 두어 경계 음량에서 흔들리지 않게 함
// 그림은 설정 창에서 바꿀 수 있다(setFaces). listen 그림을 못 읽으면 idle 그림으로 대신 보여 준다.
const Pet = (() => {
  const LISTEN_ON = 0.12; // 이보다 크면 '소리 남'
  const QUIET_BELOW = 0.06; // 이보다 작으면 '조용함'
  const LISTEN_AFTER_MS = 500;
  const IDLE_AFTER_MS = 2000;
  const NOTE_EVERY_BEATS = 4;
  const NOD_MIN_MS = 320; // 박자가 너무 촘촘해도 이보다 빨리 까딱이지 않음
  const NOD_AUTO_MS = 650; // 박자가 이만큼 안 오면 알아서 까딱
  const NOTES = ['♪', '♫', '♩'];
  // main.js가 실제 경로(사용자가 고른 그림 포함)를 알려 주기 전까지 쓰는 기본 그림
  const DEFAULT_FACES = {
    idle: '../assets/pet/idle.png',
    listen: '../assets/pet/listen.png',
  };

  function create(petEl, spriteEl) {
    let listening = false;
    let loudSince = null; // 소리가 계속 나기 시작한 시각
    let quietSince = null; // 조용함이 계속되기 시작한 시각
    let beatCount = 0;
    let mediaPlaying = null; // true/false: 미디어 정보의 재생 상태, null: 정보 없음
    let nodSide = 'right'; // 마지막으로 기운 쪽. 첫 까딱은 왼쪽
    let lastNodAt = 0;

    let faces = {};

    function setFace(name) {
      const src = faces[name];
      if (src && spriteEl.getAttribute('src') !== src) spriteEl.setAttribute('src', src);
    }

    // 미리 읽어 두어 표정이 바뀔 때 깜빡이지 않게 하고, 못 읽은 표정은 idle로 대체
    function setFaces(urls) {
      faces = { ...urls };
      for (const [name, src] of Object.entries(urls)) {
        if (!src) continue; // left/right는 없을 수 있음
        const img = new Image();
        img.onerror = () => {
          if (faces[name] !== src) return; // 그 사이 다른 그림으로 바뀜
          faces[name] = faces.idle;
          setFace(listening ? 'listen' : 'idle');
        };
        img.src = src;
      }
      setFace(listening ? 'listen' : 'idle');
    }

    setFaces(DEFAULT_FACES);

    function hop() {
      // 애니메이션이 끝나기 전에 다음 까딱이 와도 처음부터 다시 재생
      spriteEl.classList.remove('hop');
      void spriteEl.offsetWidth;
      spriteEl.classList.add('hop');
    }

    // 고개 까딱: 반대쪽으로 기울이고 살짝 통통
    function nod(now) {
      lastNodAt = now;
      nodSide = nodSide === 'left' ? 'right' : 'left';
      if (faces[nodSide]) {
        setFace(nodSide);
        delete petEl.dataset.tilt;
      } else {
        setFace('listen');
        petEl.dataset.tilt = nodSide;
      }
      hop();
    }

    function spawnNote() {
      const note = document.createElement('span');
      note.className = 'note';
      note.textContent = NOTES[Math.floor(Math.random() * NOTES.length)];
      note.style.left = `${35 + Math.random() * 40}%`;
      note.style.setProperty('--drift', `${(Math.random() - 0.5) * 40}px`);
      note.addEventListener('animationend', () => note.remove());
      petEl.appendChild(note);
    }

    function setListening(value) {
      if (listening === value) return;
      listening = value;
      petEl.classList.toggle('listening', value);
      delete petEl.dataset.tilt;
      setFace(value ? 'listen' : 'idle');
    }

    function update({ loudness, beat }, now) {
      loudSince = loudness > LISTEN_ON ? (loudSince ?? now) : null;
      quietSince = loudness < QUIET_BELOW ? (quietSince ?? now) : null;

      if (mediaPlaying !== null) {
        setListening(mediaPlaying);
      } else if (!listening && loudSince !== null && now - loudSince >= LISTEN_AFTER_MS) {
        setListening(true);
      } else if (listening && quietSince !== null && now - quietSince >= IDLE_AFTER_MS) {
        setListening(false);
      }

      if (!listening) return;
      if ((beat && now - lastNodAt >= NOD_MIN_MS) || now - lastNodAt >= NOD_AUTO_MS) nod(now);
      if (beat) {
        beatCount++;
        if (beatCount % NOTE_EVERY_BEATS === 0) spawnNote();
      }
    }

    return {
      update,
      setFaces,
      setMediaPlaying(value) {
        mediaPlaying = value;
        if (value !== null) setListening(value); // 다음 프레임을 기다리지 않고 바로
      },
    };
  }

  return { create };
})();
