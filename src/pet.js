// 캐릭터 상태와 연출
//  - idle: 가만히
//  - listening: 소리가 나는 동안 좌우로 천천히 흔들림 (#pet.listening)
//  - beat: 박자마다 통통 튀고, 몇 박자에 한 번 머리 위로 ♪가 떠오름
const Pet = (() => {
  const LISTEN_ON = 0.12; // 이 loudness를 넘으면 듣는 중
  const QUIET_TO_IDLE_MS = 1500; // 조용해지고 이만큼 지나면 idle
  const NOTE_EVERY_BEATS = 4;
  const NOTES = ['♪', '♫', '♩'];

  function create(petEl, spriteEl) {
    let listening = false;
    let lastLoudAt = 0;
    let beatCount = 0;

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
        beatCount++;
        if (beatCount % NOTE_EVERY_BEATS === 0) spawnNote();
      }
    }

    return { update };
  }

  return { create };
})();
