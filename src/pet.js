// 캐릭터 상태와 연출 (그림 세 장: idle, left, right)
//  - idle: 가만히 (idle 그림)
//  - listening: 고개를 까딱까딱. 일정한 간격으로 left/right 그림을 번갈아 보여 주고,
//    그때마다 몸을 좌우로 기울이고 살짝 올라갔다 내려온다.
//    left/right 그림을 못 쓰면 idle 그림을 그대로 보여 준다.
//    몇 박자에 한 번 머리 위로 ♪가 떠오름
//  - 애니메이션(설정 창, setAnimation): 까딱 간격, 좌우 기울기 각도(0이면 안 기울어짐),
//    통통 높이(0이면 안 튐), ♪ 음표 켜기/끄기
//  - 크기: 설정 창에서 60~120% (setSize). 캐릭터 칸 폭과 맞춤 높이가 함께 커지고 작아진다.
//
// 전환 기준
//  1) 재생 앱이 Windows 미디어 정보로 재생 상태를 알려 주면(setMediaPlaying) 그대로 따른다.
//     노래가 시작/정지되면 바로 바뀌고, 곡 중간의 조용한 부분에도 흔들리지 않는다.
//  2) 알려 주지 않으면(null) 소리 크기로 판단한다.
//     - idle → listening: 소리(loudness > LISTEN_ON)가 LISTEN_AFTER_MS 동안 이어질 때
//     - listening → idle: 조용함(loudness < QUIET_BELOW)이 IDLE_AFTER_MS 동안 이어질 때
//     - QUIET_BELOW를 LISTEN_ON보다 낮게 두어 경계 음량에서 흔들리지 않게 함
//
// 배치: 그림마다 여백이 달라도 캐릭터 칸(#pet)에 딱 맞도록, main.js가 잰 '실제로 그려진 영역'
// (bounds)을 모든 표정에 걸쳐 합친 뒤 그 영역이 칸 안에 들어오게 크기와 위치를 정한다.
// 모든 표정에 같은 기준을 쓰므로 표정이 바뀌어도 캐릭터가 튀지 않는다.
//
// 그리기: 캐릭터는 캔버스(#pet-canvas)에 직접 그린다. 브라우저가 움직이는 그림을 저품질로
// 다시 축소·보간하면 선이 흐려지므로,
//  - 원본을 화면에 실제로 찍히는 픽셀 크기(1배)와 그 2배로 미리 고품질 축소해 두고
//  - 기울기 0일 때는 1배 그림을 화면 픽셀 격자에 1:1로 찍고(통통 높이도 픽셀 단위로 맞춤)
//  - 기울어 있을 때는 2배 그림에서 고품질로 회전해 그린다.
const Pet = (() => {
  const LISTEN_ON = 0.12; // 이보다 크면 '소리 남'
  const QUIET_BELOW = 0.06; // 이보다 작으면 '조용함'
  const LISTEN_AFTER_MS = 500;
  const IDLE_AFTER_MS = 2000;
  const NOTE_EVERY_BEATS = 4;
  const DEFAULT_ANIMATION = { interval: 0.9, tilt: 0, bob: 2.5, notes: true };
  const NOTES = ['♪', '♫', '♩'];
  const FIT_RATIO = 0.94; // 칸 가장자리에 여유를 조금 남김
  const BASE_BOX_WIDTH = 104; // 크기 100%일 때 캐릭터 칸 폭(px)
  const CANVAS_PAD = 0.3; // 기울기·통통·크기 120%로 칸 밖에 걸치는 부분까지 그리도록 칸 둘레 여유
  const FULL_BOUNDS = { x0: 0, y0: 0, x1: 1, y1: 1 };
  // main.js가 실제 경로(사용자가 고른 그림 포함)를 알려 주기 전까지 쓰는 기본 그림
  const DEFAULT_FACES = {
    idle: '../assets/pet/idle.png',
    left: '../assets/pet/left.png',
    right: '../assets/pet/right.png',
  };

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  }

  function create(petEl) {
    const canvas = petEl.querySelector('#pet-canvas');
    const ctx = canvas.getContext('2d');

    let listening = false;
    let loudSince = null; // 소리가 계속 나기 시작한 시각
    let quietSince = null; // 조용함이 계속되기 시작한 시각
    let beatCount = 0;
    let mediaPlaying = null; // true/false: 미디어 정보의 재생 상태, null: 정보 없음
    let nodSide = 'right'; // 마지막으로 기운 쪽. 첫 까딱은 왼쪽
    let lastNodAt = 0;

    let faces = {}; // 표정 이름 → 원본 URL
    let fitBounds = FULL_BOUNDS; // 모든 표정의 그려진 영역을 합친 것
    let size = 1; // 캐릭터 크기 배율 (설정 창)
    let animation = { ...DEFAULT_ANIMATION };

    // ---- 그림 준비 ----

    const originals = new Map(); // 원본 URL → Promise<Image>
    let prepared = new Map(); // 원본 URL → {x1, x2} 미리 줄여 둔 ImageBitmap (지금 크기 기준)
    let preparedKey = ''; // prepared가 어떤 크기 기준인지
    let layout = null; // 칸 안 배치 (CSS px, 칸 왼쪽 위 기준)
    let shownSrc = null; // 지금 그리는 그림의 원본 URL
    let wantedName = null; // 보여 주려는 표정
    let faceToken = 0;

    // 화면 픽셀 / CSS px. 위젯 크기(페이지 확대)도 여기에 포함된다.
    function pixelRatio() {
      return window.devicePixelRatio || 1;
    }

    function loadOriginal(src) {
      if (!originals.has(src)) {
        originals.set(
          src,
          new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
          })
        );
      }
      return originals.get(src);
    }

    // 합친 그려진 영역이 칸 가운데에 FIT_RATIO만큼 차도록 크기와 위치(CSS px)를 정한다
    function layoutFor(orig) {
      const boxW = petEl.clientWidth;
      const boxH = petEl.clientHeight;
      const natW = orig.naturalWidth;
      const natH = orig.naturalHeight;
      if (!boxW || !boxH || !natW || !natH) return null;
      const drawnW = (fitBounds.x1 - fitBounds.x0) * natW;
      const drawnH = (fitBounds.y1 - fitBounds.y0) * natH;
      // 100%보다 크면 칸 위아래로 조금 넘쳐도 됨
      const scale = Math.min((boxW * FIT_RATIO) / drawnW, (boxH * size * FIT_RATIO) / drawnH);
      const drawnTop = (boxH - drawnH * scale) / 2;
      return {
        width: natW * scale,
        height: natH * scale,
        left: (boxW - drawnW * scale) / 2 - fitBounds.x0 * natW * scale,
        top: drawnTop - fitBounds.y0 * natH * scale,
        drawnTop,
        feetX: boxW / 2,
        feetY: drawnTop + drawnH * scale,
      };
    }

    function shrink(orig, w, h) {
      return createImageBitmap(orig, {
        resizeWidth: Math.max(1, Math.round(w)),
        resizeHeight: Math.max(1, Math.round(h)),
        resizeQuality: 'high',
      });
    }

    // 표정 그림을 지금 크기에 맞춰 1배/2배로 준비 (크기가 바뀌면 다시)
    async function prepare(src) {
      const orig = await loadOriginal(src);
      const newLayout = layoutFor(orig);
      if (!newLayout) return null;
      const px = pixelRatio();
      const key = `${petEl.clientWidth}x${petEl.clientHeight}|${size}|${px}|${JSON.stringify(fitBounds)}`;
      if (key !== preparedKey) {
        for (const { x1, x2 } of prepared.values()) {
          x1.close();
          x2.close();
        }
        prepared = new Map();
        preparedKey = key;
      }
      layout = newLayout;
      if (!prepared.has(src)) {
        const w = newLayout.width * px;
        const h = newLayout.height * px;
        const [x1, x2] = await Promise.all([shrink(orig, w, h), shrink(orig, w * 2, h * 2)]);
        if (preparedKey !== key) {
          x1.close();
          x2.close();
          return null; // 그 사이 크기가 또 바뀜
        }
        prepared.set(src, { x1, x2 });
      }
      return prepared.get(src);
    }

    // ---- 그리기 ----

    let tiltFrom = 0;
    let tiltTo = 0;
    let tiltStart = 0;
    let bobStart = -Infinity;
    let frame = 0;

    function tiltDuration() {
      return Math.min(550, animation.interval * 600); // 다음 까딱 전에 다 넘어가도록
    }

    function bobDuration() {
      return Math.min(600, animation.interval * 650);
    }

    function currentTilt(now) {
      const t = Math.min(1, (now - tiltStart) / tiltDuration());
      return tiltFrom + (tiltTo - tiltFrom) * easeInOut(t);
    }

    function currentRise(now) {
      const t = (now - bobStart) / bobDuration();
      if (t < 0 || t >= 1 || animation.bob <= 0) return 0;
      // 40% 지점에서 가장 높이 올라갔다 부드럽게 내려옴
      const lift = t < 0.4 ? easeInOut(t / 0.4) : 1 - easeInOut((t - 0.4) / 0.6);
      return (petEl.clientHeight * animation.bob * lift) / 100;
    }

    function draw() {
      frame = 0;
      const now = performance.now();
      const bitmaps = shownSrc && prepared.get(shownSrc);
      const px = pixelRatio();
      const boxW = petEl.clientWidth;
      const boxH = petEl.clientHeight;
      const padX = Math.round(boxW * CANVAS_PAD);
      const padY = Math.round(boxH * CANVAS_PAD);
      const cssW = boxW + padX * 2;
      const cssH = boxH + padY * 2;
      if (canvas.width !== Math.round(cssW * px) || canvas.height !== Math.round(cssH * px)) {
        canvas.width = Math.round(cssW * px);
        canvas.height = Math.round(cssH * px);
        canvas.style.width = `${canvas.width / px}px`;
        canvas.style.height = `${canvas.height / px}px`;
        alignCanvas(padX, padY);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!bitmaps || !layout) return;

      const angle = currentTilt(now);
      const rise = currentRise(now);
      if (Math.abs(angle) < 0.01) {
        // 기울기 없음: 1배 그림을 화면 픽셀에 딱 맞춰 그대로 찍음 (가장 선명)
        const x = Math.round((padX + layout.left) * px);
        const y = Math.round((padY + layout.top - rise) * px);
        ctx.drawImage(bitmaps.x1, x, y);
      } else {
        // 기울어짐: 발을 축으로 회전해, 2배 그림을 고품질로 줄여 그림
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.setTransform(px, 0, 0, px, 0, 0);
        ctx.translate(padX + layout.feetX, padY + layout.feetY - rise);
        ctx.rotate((angle * Math.PI) / 180);
        ctx.drawImage(bitmaps.x2, layout.left - layout.feetX, layout.top - layout.feetY, layout.width, layout.height);
      }

      // 기울기가 넘어가는 중이거나 통통 중이면 다음 프레임도 그림
      const tilting = now - tiltStart < tiltDuration();
      const bobbing = now - bobStart < bobDuration();
      if (tilting || bobbing) requestDraw();
    }

    // 캔버스가 화면 픽셀 격자에 딱 맞게 놓이도록 위치를 미세 조정한다.
    // 위젯 크기(예: 150%)나 화면 배율 때문에 칸 위치가 0.5픽셀 같은 곳에 걸리면 캔버스 전체가 번지기 때문.
    function alignCanvas(padX, padY) {
      canvas.style.left = `${-padX}px`;
      canvas.style.top = `${-padY}px`;
      const rect = canvas.getBoundingClientRect(); // 창 기준 CSS px
      const px = pixelRatio();
      const offX = rect.left * px - Math.round(rect.left * px); // 화면 픽셀 기준 어긋난 양
      const offY = rect.top * px - Math.round(rect.top * px);
      canvas.style.left = `${-padX - offX / px}px`;
      canvas.style.top = `${-padY - offY / px}px`;
    }

    function requestDraw() {
      if (!frame) frame = requestAnimationFrame(draw);
    }

    // 보여 줄 표정을 준비한 뒤 한 번에 바꿔 그림 (빈 화면 깜빡임 없음)
    async function setFace(name) {
      const src = faces[name];
      if (!src) return;
      wantedName = name;
      const token = ++faceToken;
      let ready;
      try {
        ready = await prepare(src);
      } catch (err) {
        if (faces[name] === src) {
          faces[name] = null; // 못 쓰는 그림 (left/right면 idle로 대신)
          showCurrentFace();
        }
        return;
      }
      if (!ready || token !== faceToken) return; // 그 사이 다른 표정으로 바뀜
      shownSrc = src;
      petEl.style.setProperty('--drawn-top', `${layout.drawnTop}px`); // 음표는 머리 위에서
      requestDraw();
    }

    // 칸 크기/위젯 크기/화면 배율이 바뀌면 지금 표정을 새 크기로 다시 준비
    function relayout() {
      canvas.width = 0; // 다음 그리기 때 크기와 격자 맞춤을 다시 계산
      if (wantedName) setFace(wantedName);
      else requestDraw();
    }

    // 모니터를 옮겨 화면 배율이 바뀔 때도 다시 준비
    (function watchPixelRatio() {
      matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
        'change',
        () => {
          relayout();
          watchPixelRatio();
        },
        { once: true }
      );
    })();

    // 새 그림 목록. 미리 읽어 두고, 못 읽은 표정은 idle로 대체
    function setFaces(urls, bounds = {}) {
      faces = { ...urls };
      // 있는 표정들의 그려진 영역을 모두 합침 (못 잰 그림은 그림 전체로)
      const boxes = Object.keys(urls)
        .filter((name) => urls[name])
        .map((name) => bounds[name] || FULL_BOUNDS);
      fitBounds = boxes.length
        ? {
            x0: Math.min(...boxes.map((b) => b.x0)),
            y0: Math.min(...boxes.map((b) => b.y0)),
            x1: Math.max(...boxes.map((b) => b.x1)),
            y1: Math.max(...boxes.map((b) => b.y1)),
          }
        : FULL_BOUNDS;
      for (const [name, src] of Object.entries(urls)) {
        if (!src) continue; // left/right는 없을 수 있음
        loadOriginal(src).catch(() => {
          if (faces[name] !== src) return; // 그 사이 다른 그림으로 바뀜
          faces[name] = null;
          showCurrentFace();
        });
      }
      showCurrentFace();
    }

    // 지금 상태에 맞는 그림: 듣는 중이면 마지막으로 기운 쪽(left/right), 아니면 idle
    function showCurrentFace() {
      if (!listening) {
        setFace('idle');
        return;
      }
      setFace(faces[nodSide] ? nodSide : 'idle');
    }

    // ---- 움직임 ----

    // 지금 각도에서 목표 각도로 천천히 넘어가기 시작
    function setTilt(target) {
      const now = performance.now();
      tiltFrom = currentTilt(now);
      tiltTo = target;
      tiltStart = now;
      requestDraw();
    }

    function bob() {
      bobStart = performance.now(); // 끝나기 전에 다음 까딱이 와도 처음부터 다시
      requestDraw();
    }

    // 고개 까딱: left/right 그림을 바꾸고, 그쪽으로 기울며 살짝 올라갔다 내려온다
    function nod(now) {
      lastNodAt = now;
      nodSide = nodSide === 'left' ? 'right' : 'left';
      showCurrentFace();
      setTilt(nodSide === 'left' ? -animation.tilt : animation.tilt);
      if (animation.bob > 0) bob();
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
      if (value) {
        nod(performance.now()); // 듣기 시작하면 바로 첫 까딱
      } else {
        setTilt(0);
        setFace('idle');
      }
    }

    // ---- 설정 ----

    // {interval: 초, tilt: 도, bob: %, notes: bool}
    function setAnimation(value) {
      animation = { ...DEFAULT_ANIMATION, ...value };
      if (listening) setTilt(nodSide === 'left' ? -animation.tilt : animation.tilt);
    }

    function setSize(value) {
      size = value;
      petEl.style.width = `${BASE_BOX_WIDTH * size}px`;
      relayout();
    }

    setFaces(DEFAULT_FACES);

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
      if (now - lastNodAt >= animation.interval * 1000) nod(now);
      if (beat && animation.notes) {
        beatCount++;
        if (beatCount % NOTE_EVERY_BEATS === 0) spawnNote();
      }
    }

    return {
      update,
      setFaces,
      relayout,
      setSize,
      setAnimation,
      setMediaPlaying(value) {
        mediaPlaying = value;
        if (value !== null) setListening(value); // 다음 프레임을 기다리지 않고 바로
      },
    };
  }

  return { create };
})();
