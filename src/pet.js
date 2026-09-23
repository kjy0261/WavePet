// 캐릭터 상태와 연출
//  - idle: 가만히 (idle.png)
//  - listening: 소리가 나는 동안 좌우로 천천히 흔들림 (#pet.listening, listen.png)
//  - beat: 박자마다 통통 튀며 잠깐 beat.png로 바뀌고, 몇 박자에 한 번 머리 위로 ♪가 떠오름
// listen.png / beat.png가 없거나 못 읽으면 idle.png로 대신 보여 준다.
const Pet = (() => {
  const LISTEN_ON = 0.12; // 이 loudness를 넘으면 듣는 중
  const QUIET_TO_IDLE_MS = 1500; // 조용해지고 이만큼 지나면 idle
  const NOTE_EVERY_BEATS = 4;
  const NOTES = ['♪', '♫', '♩'];
  const BEAT_FACE_MS = 180; // 박자 표정을 보여 주는 시간
  const FACE_FILES = {
    idle: '../assets/pet/idle.png',
    listen: '../assets/pet/listen.png',
    beat: '../assets/pet/beat.png',
  };

  function create(petEl, spriteEl) {
    let listening = false;
    let lastLoudAt = 0;
    let beatCount = 0;
    let beatFaceTimer = null;

    // 미리 읽어 두어 표정이 바뀔 때 깜빡이지 않게 하고, 못 읽은 표정은 idle로 대체
    const faces = { ...FACE_FILES };
    for (const [name, src] of Object.entries(FACE_FILES)) {
      const img = new Image();
      img.onerror = () => {
        faces[name] = FACE_FILES.idle;
      };
      img.src = src;
    }

    function setFace(name) {
      const src = faces[name];
      if (spriteEl.getAttribute('src') !== src) spriteEl.setAttribute('src', src);
    }

    function restingFace() {
      return listening ? 'listen' : 'idle';
    }

    function bounce() {
      // 애니메이션이 끝나기 전에 다음 박자가 와도 처음부터 다시 재생
      spriteEl.classList.remove('bounce');
      void spriteEl.offsetWidth;
      spriteEl.classList.add('bounce');
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
      if (!beatFaceTimer) setFace(restingFace());
    }

    function update({ loudness, beat }, now) {
      if (loudness > LISTEN_ON) {
        lastLoudAt = now;
        setListening(true);
      } else if (listening && now - lastLoudAt > QUIET_TO_IDLE_MS) {
        setListening(false);
      }

      if (beat && listening) {
        bounce();
        setFace('beat');
        clearTimeout(beatFaceTimer);
        beatFaceTimer = setTimeout(() => {
          beatFaceTimer = null;
          setFace(restingFace());
        }, BEAT_FACE_MS);
        beatCount++;
        if (beatCount % NOTE_EVERY_BEATS === 0) spawnNote();
      }
    }

    return { update };
  }

  return { create };
})();
