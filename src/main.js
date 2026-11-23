import './styles.css';
import {
  DIFFICULTIES,
  generateLevel,
  rotateTile,
  tileKey,
  traceFlow,
} from './engine.js';
import {
  isMuted,
  playBloomFanfare,
  playRotateSound,
  playSplashSound,
  playWaterBubble,
  setMuted,
} from './audio.js';

const STORAGE_KEY = 'pipe-garden-bloomed-count';

function readBloomedCount() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
  } catch {
    return 0;
  }
}

function saveBloomedCount(count) {
  try {
    localStorage.setItem(STORAGE_KEY, String(count));
  } catch {
    // Ignore storage errors (e.g. private browsing / quota)
  }
}

const state = {
  difficultyId: 'sprout',
  mode: 'relaxed', // 'relaxed' | 'timed'
  level: null,
  status: 'playing', // 'playing' | 'flowing' | 'won' | 'leaked'
  reachedGoalWithLeak: false,
  flowingKeys: new Set(),
  leakKeys: new Set(),
  tileButtons: new Map(),
  bloomedCount: readBloomedCount(),
  timerLeft: 0,
  timerTotal: 0,
  timerHandle: null,
  flowTimers: [],
};

function clearTimers() {
  if (state.timerHandle) {
    clearInterval(state.timerHandle);
    state.timerHandle = null;
  }
  for (const id of state.flowTimers) clearTimeout(id);
  state.flowTimers = [];
}

function pipePaths(type) {
  switch (type) {
    case 'straight':
      return 'M 50 0 L 50 100';
    case 'curve':
      return 'M 50 0 Q 50 50 100 50';
    case 'tee':
      return 'M 50 0 L 50 100 M 50 50 L 100 50';
    case 'cross':
      return 'M 50 0 L 50 100 M 0 50 L 100 50';
    default:
      return '';
  }
}

function pipeCollars(type) {
  const collarN = `<rect x="33" y="0" width="34" height="9" rx="3.5" fill="url(#pg-collar)" stroke="#8c521c" stroke-width="2"/>`;
  const collarS = `<rect x="33" y="91" width="34" height="9" rx="3.5" fill="url(#pg-collar)" stroke="#8c521c" stroke-width="2"/>`;
  const collarE = `<rect x="91" y="33" width="9" height="34" rx="3.5" fill="url(#pg-collar-v)" stroke="#8c521c" stroke-width="2"/>`;
  const collarW = `<rect x="0" y="33" width="9" height="34" rx="3.5" fill="url(#pg-collar-v)" stroke="#8c521c" stroke-width="2"/>`;
  switch (type) {
    case 'straight':
      return collarN + collarS;
    case 'curve':
      return collarN + collarE;
    case 'tee':
      return collarN + collarS + collarE;
    case 'cross':
      return collarN + collarS + collarE + collarW;
    default:
      return '';
  }
}

const SHARED_SVG_DEFS = `
  <svg class="svg-defs-host" aria-hidden="true">
    <defs>
      <linearGradient id="pg-pipe" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#eab063"/>
        <stop offset="50%" stop-color="#d68b3c"/>
        <stop offset="100%" stop-color="#b46a24"/>
      </linearGradient>
      <linearGradient id="pg-collar" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#c47b30"/>
        <stop offset="35%" stop-color="#f6cc84"/>
        <stop offset="70%" stop-color="#d99142"/>
        <stop offset="100%" stop-color="#a86220"/>
      </linearGradient>
      <linearGradient id="pg-collar-v" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#c47b30"/>
        <stop offset="35%" stop-color="#f6cc84"/>
        <stop offset="70%" stop-color="#d99142"/>
        <stop offset="100%" stop-color="#a86220"/>
      </linearGradient>
      <radialGradient id="pg-pond" cx="42%" cy="38%" r="62%">
        <stop offset="0%" stop-color="#9fe9fc"/>
        <stop offset="55%" stop-color="#58c4e6"/>
        <stop offset="100%" stop-color="#3599bf"/>
      </radialGradient>
      <radialGradient id="pg-valve" cx="38%" cy="32%" r="65%">
        <stop offset="0%" stop-color="#ff8a80"/>
        <stop offset="60%" stop-color="#e55555"/>
        <stop offset="100%" stop-color="#b53333"/>
      </radialGradient>
    </defs>
  </svg>`;

const SPLASH_SVG = `
  <svg viewBox="0 0 64 64" aria-hidden="true">
    <path d="M32 10 C37 22 44 27 44 36 A12 12 0 0 1 20 36 C20 27 27 22 32 10 Z" fill="#46cef2" stroke="#ffffff" stroke-width="3" stroke-linejoin="round"/>
    <ellipse cx="28" cy="34" rx="3" ry="5" fill="#d9f8ff" opacity="0.85" transform="rotate(-15 28 34)"/>
    <circle cx="14" cy="22" r="4" fill="#6adbf8" stroke="#ffffff" stroke-width="2"/>
    <circle cx="51" cy="24" r="3.5" fill="#6adbf8" stroke="#ffffff" stroke-width="2"/>
    <circle cx="48" cy="48" r="3" fill="#9aeaff" stroke="#ffffff" stroke-width="1.8"/>
  </svg>`;

function renderPipeSvg(tile) {
  if (tile.type === 'faucet') {
    return `
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <path d="M 42 50 L 100 50" fill="none" stroke="#8a501a" stroke-width="32" stroke-linecap="butt"/>
        <path d="M 42 50 L 100 50" fill="none" stroke="url(#pg-pipe)" stroke-width="24" stroke-linecap="butt"/>
        <path d="M 46 44 L 94 44" fill="none" stroke="#ffe1a8" stroke-width="5" stroke-linecap="round" opacity="0.72"/>
        <path class="water-path" d="M 46 50 L 100 50" fill="none" stroke="#42ccf0" stroke-width="11" stroke-linecap="butt"/>
        <path class="water-shimmer" d="M 46 50 L 100 50" fill="none" stroke="#d4f7ff" stroke-width="3.5" stroke-linecap="round"/>
        <rect x="91" y="33" width="9" height="34" rx="3.5" fill="url(#pg-collar-v)" stroke="#8c521c" stroke-width="2"/>
        <rect x="16" y="32" width="34" height="36" rx="12" fill="url(#pg-pipe)" stroke="#8a501a" stroke-width="3.5"/>
        <rect x="22" y="37" width="12" height="6" rx="3" fill="#ffe1a8" opacity="0.65"/>
        <rect x="35" y="24" width="10" height="12" rx="3" fill="#b36c27" stroke="#8a501a" stroke-width="2"/>
        <g class="valve-wheel">
          <circle cx="40" cy="24" r="14" fill="url(#pg-valve)" stroke="#9e2a2a" stroke-width="3.5"/>
          <path d="M 30 24 H 50 M 40 14 V 34" stroke="#b53333" stroke-width="2.5" stroke-linecap="round"/>
          <circle cx="40" cy="24" r="5" fill="#ffe094" stroke="#9e2a2a" stroke-width="2"/>
        </g>
      </svg>`;
  }

  if (tile.type === 'pond') {
    return `
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <path d="M 0 50 L 42 50" fill="none" stroke="#8a501a" stroke-width="32" stroke-linecap="butt"/>
        <path d="M 0 50 L 42 50" fill="none" stroke="url(#pg-pipe)" stroke-width="24" stroke-linecap="butt"/>
        <path d="M 6 44 L 38 44" fill="none" stroke="#ffe1a8" stroke-width="5" stroke-linecap="round" opacity="0.72"/>
        <path class="water-path" d="M 0 50 L 44 50" fill="none" stroke="#42ccf0" stroke-width="11" stroke-linecap="butt"/>
        <path class="water-shimmer" d="M 0 50 L 44 50" fill="none" stroke="#d4f7ff" stroke-width="3.5" stroke-linecap="round"/>
        <rect x="0" y="33" width="9" height="34" rx="3.5" fill="url(#pg-collar-v)" stroke="#8c521c" stroke-width="2"/>
        <ellipse cx="62" cy="54" rx="32" ry="29" fill="url(#pg-pond)" stroke="#318cb0" stroke-width="3.5"/>
        <ellipse cx="57" cy="48" rx="18" ry="11" fill="#cbf4ff" opacity="0.45"/>
        <path d="M 52 67 A 16 12 0 1 1 78 64 L 66 64 Z" fill="#6bc96b" stroke="#469a46" stroke-width="2"/>
        <g class="pond-bloom">
          <g transform="translate(46 28)">
            <circle cx="0" cy="-6" r="5" fill="#ff89a6"/>
            <circle cx="6" cy="-1" r="5" fill="#ff89a6"/>
            <circle cx="4" cy="5" r="5" fill="#ff89a6"/>
            <circle cx="-4" cy="5" r="5" fill="#ff89a6"/>
            <circle cx="-6" cy="-1" r="5" fill="#ff89a6"/>
            <circle cx="0" cy="0" r="4.2" fill="#ffe169"/>
          </g>
          <g transform="translate(76 28) scale(0.85)">
            <circle cx="0" cy="-6" r="5" fill="#ffd166"/>
            <circle cx="6" cy="-1" r="5" fill="#ffd166"/>
            <circle cx="4" cy="5" r="5" fill="#ffd166"/>
            <circle cx="-4" cy="5" r="5" fill="#ffd166"/>
            <circle cx="-6" cy="-1" r="5" fill="#ffd166"/>
            <circle cx="0" cy="0" r="4.2" fill="#ff8f66"/>
          </g>
        </g>
        <g class="frog-hop">
          <ellipse cx="65" cy="59" rx="13" ry="9.5" fill="#52b858" stroke="#36873b" stroke-width="2"/>
          <ellipse cx="65" cy="62" rx="7.5" ry="4.5" fill="#a8e69a"/>
          <circle cx="59" cy="50" r="4.6" fill="#52b858" stroke="#36873b" stroke-width="1.8"/>
          <circle cx="71" cy="50" r="4.6" fill="#52b858" stroke="#36873b" stroke-width="1.8"/>
          <circle cx="59" cy="50" r="2.2" fill="#1d3320"/>
          <circle cx="71" cy="50" r="2.2" fill="#1d3320"/>
          <circle cx="58.2" cy="49.2" r="0.8" fill="#ffffff"/>
          <circle cx="70.2" cy="49.2" r="0.8" fill="#ffffff"/>
          <circle cx="55.5" cy="58.5" r="2.2" fill="#ff9eb5" opacity="0.8"/>
          <circle cx="74.5" cy="58.5" r="2.2" fill="#ff9eb5" opacity="0.8"/>
          <path d="M 61 59.5 Q 65 63.5 69 59.5" fill="none" stroke="#1d3320" stroke-width="2" stroke-linecap="round"/>
        </g>
      </svg>`;
  }

  const d = pipePaths(tile.type);
  return `
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <path d="${d}" fill="none" stroke="#8a501a" stroke-width="32" stroke-linecap="butt" stroke-linejoin="round"/>
      <path d="${d}" fill="none" stroke="url(#pg-pipe)" stroke-width="24" stroke-linecap="butt" stroke-linejoin="round"/>
      <path d="${d}" fill="none" stroke="#ffe1a8" stroke-width="5.5" stroke-linecap="butt" stroke-linejoin="round" opacity="0.58"/>
      <path class="water-path" d="${d}" fill="none" stroke="#42ccf0" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
      <path class="water-shimmer" d="${d}" fill="none" stroke="#d4f7ff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${pipeCollars(tile.type)}
    </svg>`;
}

function startTimerIfNeeded(durationSeconds = null) {
  clearTimers();
  if (state.mode !== 'timed') return;
  const duration = durationSeconds ?? state.level.difficulty.timerSeconds;
  state.timerTotal = duration;
  state.timerLeft = duration;
  updateTimerUi();

  state.timerHandle = setInterval(() => {
    if (state.status !== 'playing' && state.status !== 'leaked') {
      clearInterval(state.timerHandle);
      state.timerHandle = null;
      return;
    }
    state.timerLeft = Math.max(0, state.timerLeft - 0.25);
    updateTimerUi();
    if (state.timerLeft <= 0) {
      clearInterval(state.timerHandle);
      state.timerHandle = null;
      triggerWaterFlow();
    }
  }, 250);
}

function updateTimerUi() {
  const wrap = document.querySelector('.timer-wrap');
  if (!wrap) return;
  if (state.mode !== 'timed') {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  const pct = state.timerTotal > 0 ? (state.timerLeft / state.timerTotal) * 100 : 0;
  const fill = wrap.querySelector('.timer-fill');
  const label = wrap.querySelector('.timer-label');
  fill.style.width = `${pct}%`;
  fill.classList.toggle('urgent', state.timerLeft <= 6);
  label.textContent = `⏱️ ${Math.ceil(state.timerLeft)}s`;
}

function spawnCelebration() {
  const layer = document.querySelector('.celebration-layer');
  if (!layer) return;
  layer.innerHTML = '';
  const emojis = ['🌸', '💧', '✨', '🌼', '🐸', '🌷'];
  for (let i = 0; i < 18; i += 1) {
    const el = document.createElement('span');
    el.className = 'sparkle-drop';
    el.textContent = emojis[i % emojis.length];
    el.style.left = `${20 + Math.random() * 60}%`;
    el.style.top = `${20 + Math.random() * 60}%`;
    el.style.setProperty('--dx', `${(Math.random() - 0.5) * 180}px`);
    el.style.setProperty('--dy', `${-40 - Math.random() * 120}px`);
    el.style.animationDelay = `${i * 0.04}s`;
    layer.appendChild(el);
  }
}

function updateBoardStates(flow = traceFlow(state.level)) {
  const frame = document.querySelector('.board-frame');
  if (frame) {
    frame.classList.toggle('board-flowing', state.status === 'flowing' || state.status === 'won');
    frame.classList.toggle('board-won', state.status === 'won');
  }

  for (let r = 0; r < state.level.size; r += 1) {
    for (let c = 0; c < state.level.size; c += 1) {
      const tile = state.level.grid[r][c];
      const key = tileKey(r, c);
      const btn = state.tileButtons.get(key);
      if (!btn) continue;

      const rotor = btn.querySelector('.pipe-rotor');
      if (rotor && !tile.locked) {
        rotor.style.transform = `rotate(${tile.visualRotation * 90}deg)`;
      }

      btn.classList.toggle('connected', flow.connectedKeys.has(key));
      btn.classList.toggle('flowing', state.flowingKeys.has(key));
      btn.classList.toggle('leaking', state.leakKeys.has(key));

      const existingSplash = btn.querySelector('.splash-badge');
      if (state.leakKeys.has(key)) {
        if (!existingSplash) {
          const splash = document.createElement('span');
          splash.className = 'splash-badge';
          splash.innerHTML = SPLASH_SVG;
          btn.appendChild(splash);
        }
      } else if (existingSplash) {
        existingSplash.remove();
      }
    }
  }

  updateStatusAndButtons();
}

function updateStatusAndButtons() {
  const banner = document.querySelector('.status-banner');
  const primaryBtn = document.querySelector('.primary-btn');
  const scorePill = document.querySelector('.score-pill');
  if (scorePill) scorePill.textContent = `🌸 ${state.bloomedCount} Bloomed`;

  if (!banner || !primaryBtn) return;

  banner.className = 'status-banner';
  primaryBtn.className = 'primary-btn';

  if (state.status === 'won') {
    banner.classList.add('win');
    banner.textContent = '🎉 Yay! The garden bloomed and the frog is happy!';
    primaryBtn.classList.add('win-next');
    primaryBtn.textContent = 'Next Garden →';
  } else if (state.status === 'flowing') {
    banner.textContent = '💧 Splish splash! Here comes the water...';
    primaryBtn.textContent = '💧 Water Flowing...';
  } else if (state.status === 'leaked') {
    banner.classList.add('leak');
    banner.textContent = state.reachedGoalWithLeak
      ? '💦 Almost! Fix the leaky branch so no water spills!'
      : '💦 Oops, a splashy leak! Tap the pipes to fix it!';
    primaryBtn.textContent = '💧 Try Water Again!';
  } else {
    banner.textContent = 'Tap pipes to turn them and connect the faucet to the pond!';
    primaryBtn.textContent = state.mode === 'timed' ? '💧 Flow Water Now!' : '💧 Turn On Water!';
  }
}

function triggerWaterFlow() {
  if (state.status === 'flowing' || state.status === 'won') return;
  clearTimers();
  state.status = 'flowing';
  state.reachedGoalWithLeak = false;
  state.flowingKeys = new Set();
  state.leakKeys = new Set();

  const flow = traceFlow(state.level);
  updateBoardStates(flow);

  flow.waves.forEach((wave, waveIndex) => {
    const t = setTimeout(() => {
      for (const cell of wave) {
        state.flowingKeys.add(tileKey(cell.r, cell.c));
      }
      playWaterBubble(waveIndex);
      updateBoardStates(flow);
    }, waveIndex * 145);
    state.flowTimers.push(t);
  });

  const finishDelay = flow.waves.length * 145 + 160;
  const endTimer = setTimeout(() => {
    if (flow.reachedGoal && flow.leaks.length === 0) {
      state.status = 'won';
      state.bloomedCount += 1;
      saveBloomedCount(state.bloomedCount);
      playBloomFanfare();
      spawnCelebration();
    } else {
      state.status = 'leaked';
      state.reachedGoalWithLeak = flow.reachedGoal && flow.leaks.length > 0;
      state.leakKeys = new Set(flow.leaks.map((l) => tileKey(l.r, l.c)));
      playSplashSound();
    }
    updateBoardStates(flow);
  }, finishDelay);
  state.flowTimers.push(endTimer);
}

function loadNewLevel(difficultyId = state.difficultyId) {
  clearTimers();
  state.difficultyId = difficultyId;
  state.level = generateLevel(difficultyId);
  state.status = 'playing';
  state.reachedGoalWithLeak = false;
  state.flowingKeys = new Set();
  state.leakKeys = new Set();
  renderApp();
  startTimerIfNeeded();
}

function handleTileClick(r, c) {
  if (state.status === 'flowing' || state.status === 'won') return;
  const tile = state.level.grid[r][c];
  if (tile.type === 'faucet') {
    triggerWaterFlow();
    return;
  }
  if (!rotateTile(state.level, r, c)) return;

  if (state.status === 'leaked') {
    state.status = 'playing';
    state.reachedGoalWithLeak = false;
    state.flowingKeys = new Set();
    state.leakKeys = new Set();
    if (state.mode === 'timed') {
      startTimerIfNeeded(Math.min(10, state.level.difficulty.timerSeconds));
    }
  }

  const flow = traceFlow(state.level);
  playRotateSound(flow.connectedKeys.has(tileKey(r, c)));
  updateBoardStates(flow);
}

function renderApp() {
  const app = document.querySelector('#app');
  const { size, grid } = state.level;

  app.innerHTML = `
    ${SHARED_SVG_DEFS}
    <nav class="top-nav">
      <a class="home-link" href="https://sofakodev.github.io/levis-games/">← Levi's Games</a>
      <span class="score-pill">🌸 ${state.bloomedCount} Bloomed</span>
      <button class="icon-btn mute-btn" type="button" aria-label="Toggle sound">${isMuted() ? '🔇 Sound Off' : '🔊 Sound'}</button>
    </nav>

    <header class="title-block">
      <h1>Pipe Garden</h1>
      <p class="subtitle">Guide sparkling water to the thirsty flowers & frog pond!</p>
    </header>

    <div class="controls-bar">
      <div class="diff-group" role="group" aria-label="Garden size">
        ${DIFFICULTIES.map(
          (d) => `
          <button type="button" class="pill-btn diff-btn ${d.id === state.difficultyId ? 'active' : ''}" data-diff="${d.id}">
            ${d.emoji} ${d.size}×${d.size}
          </button>`,
        ).join('')}
      </div>
      <div class="mode-group" role="group" aria-label="Flow mode">
        <button type="button" class="pill-btn mode-btn ${state.mode === 'relaxed' ? 'active' : ''}" data-mode="relaxed">🌿 Relaxed</button>
        <button type="button" class="pill-btn mode-btn ${state.mode === 'timed' ? 'active' : ''}" data-mode="timed">⏱️ Timed</button>
      </div>
    </div>

    <div class="timer-wrap ${state.mode === 'timed' ? '' : 'hidden'}">
      <span class="timer-label">⏱️ ${state.level.difficulty.timerSeconds}s</span>
      <div class="timer-track"><div class="timer-fill" style="width: 100%"></div></div>
    </div>

    <section class="board-frame" aria-label="Pipe Garden board">
      <div class="board-grid" style="grid-template-columns: repeat(${size}, 1fr); grid-template-rows: repeat(${size}, 1fr);">
        ${grid
          .flat()
          .map((tile) => {
            const alt = (tile.r + tile.c) % 2 === 1 ? 'alt' : '';
            const locked = tile.locked ? 'locked' : '';
            const faucet = tile.type === 'faucet' ? 'faucet-tile' : '';
            const disabled = tile.type === 'pond' ? 'disabled' : '';
            const label =
              tile.type === 'faucet'
                ? 'Garden faucet — tap to turn on water'
                : tile.type === 'pond'
                  ? 'Flower and frog pond goal'
                  : `Pipe at row ${tile.r + 1}, column ${tile.c + 1} — tap to rotate`;
            return `
              <button
                type="button"
                class="pipe-tile ${alt} ${locked} ${faucet}"
                data-r="${tile.r}"
                data-c="${tile.c}"
                aria-label="${label}"
                ${disabled}>
                <span class="pipe-rotor" style="transform: rotate(${tile.locked ? 0 : tile.visualRotation * 90}deg)">
                  ${renderPipeSvg(tile)}
                </span>
              </button>`;
          })
          .join('')}
      </div>
      <div class="celebration-layer" aria-hidden="true"></div>
    </section>

    <div class="status-banner" role="status" aria-live="polite"></div>

    <div class="action-bar">
      <button type="button" class="primary-btn">💧 Turn On Water!</button>
      <button type="button" class="secondary-btn new-btn">✨ New Garden</button>
    </div>
  `;

  state.tileButtons = new Map();
  app.querySelectorAll('.pipe-tile').forEach((btn) => {
    const r = Number(btn.dataset.r);
    const c = Number(btn.dataset.c);
    state.tileButtons.set(tileKey(r, c), btn);
    btn.addEventListener('click', () => {
      handleTileClick(r, c);
    });
  });

  app.querySelectorAll('.diff-btn').forEach((btn) => {
    btn.addEventListener('click', () => loadNewLevel(btn.dataset.diff));
  });

  app.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.mode = btn.dataset.mode;
      loadNewLevel(state.difficultyId);
    });
  });

  app.querySelector('.mute-btn').addEventListener('click', (e) => {
    setMuted(!isMuted());
    e.currentTarget.textContent = isMuted() ? '🔇 Sound Off' : '🔊 Sound';
  });

  app.querySelector('.primary-btn').addEventListener('click', () => {
    if (state.status === 'won') {
      loadNewLevel(state.difficultyId);
    } else {
      triggerWaterFlow();
    }
  });

  app.querySelector('.new-btn').addEventListener('click', () => {
    loadNewLevel(state.difficultyId);
  });

  updateBoardStates();
}

loadNewLevel('sprout');
