// 캐릭터 상태와 연출
//  - idle(idle.png): 가만히
//  - listening(listen.png): 좌우로 천천히 흔들림 (#pet.listening).
//    박자마다 통통 튀고, 몇 박자에 한 번 머리 위로 ♪가 떠오름
//
// 상태가 자주 왔다 갔다 하지 않도록 전환 기준을 둔다.
//  - idle → listening: 소리(loudness > LISTEN_ON)가 LISTEN_AFTER_MS 동안 끊김 없이 이어질 때
//    (알림음처럼 잠깐 나는 소리에는 반응하지 않음)
//  - listening → idle: 조용함(loudness < QUIET_BELOW)이 IDLE_AFTER_MS 동안 이어질 때
//    (곡 중간의 조용한 부분이나 곡 사이 공백에서는 그대로 듣는 중)
//  - QUIET_BELOW를 LISTEN_ON보다 낮게 두어 경계 음량에서 흔들리지 않게 함
// listen.png가 없거나 못 읽으면 idle.png로 대신 보여 준다.
const Pet = (() => {
  const LISTEN_ON = 0.12; // 이보다 크면 '소리 남'
  const QUIET_BELOW = 0.06; // 이보다 작으면 '조용함'
  const LISTEN_AFTER_MS = 1000;
  const IDLE_AFTER_MS = 4000;
  const NOTE_EVERY_BEATS = 4;
  const NOTES = ['♪', '♫', '♩'];
  const FACE_FILES = {
    idle: '../assets/pet/idle.png',
    listen: '../assets/pet/listen.png',
  };

  function create(petEl, spriteEl) {
    let listening = false;
    let loudSince = null; // 소리가 계속 나기 시작한 시각
    let quietSince = null; // 조용함이 계속되기 시작한 시각
    let beatCount = 0;

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
      setFace(value ? 'listen' : 'idle');
    }

    function update({ loudness, beat }, now) {
      loudSince = loudness > LISTEN_ON ? (loudSince ?? now) : null;
      quietSince = loudness < QUIET_BELOW ? (quietSince ?? now) : null;

      if (!listening && loudSince !== null && now - loudSince >= LISTEN_AFTER_MS) {
        setListening(true);
      } else if (listening && quietSince !== null && now - quietSince >= IDLE_AFTER_MS) {
        setListening(false);
      }

      if (beat && listening) {
        bounce();
        beatCount++;
        if (beatCount % NOTE_EVERY_BEATS === 0) spawnNote();
      }
    }

    return { update };
  }

  return { create };
})();
