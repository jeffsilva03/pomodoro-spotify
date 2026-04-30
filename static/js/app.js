/* ─────────────────────────────────────────────────────────────────────────────
   FOCO! — Main App JS
   Handles: Navigation, Pomodoro Timer, Spotify SDK, Music Controls, Stats
───────────────────────────────────────────────────────────────────────────── */

// ── State ─────────────────────────────────────────────────────────────────────
const FOCUS_MODES = {
  deep: { label: 'Deep Work', icon: 'brain', focusMin: 50, breakMin: 10, lockMusic: true, lockPause: true },
  study: { label: 'Estudo Leve', icon: 'book', focusMin: 25, breakMin: 5, lockMusic: false, lockPause: false },
  creative: { label: 'Criativo', icon: 'palette', focusMin: 30, breakMin: 5, lockMusic: false, lockPause: false },
};

const BREAK_TIPS = [
  { icon: 'droplet', text: 'Beba água' },
  { icon: 'walk', text: 'Levante e caminhe 1 min' },
  { icon: 'activity', text: 'Respire fundo por 1 min' },
  { icon: 'eye', text: 'Olhe para longe (regra 20-20-20)' },
  { icon: 'activity', text: 'Faça um alongamento' },
];

const state = {
  // Timer
  focusMin: INITIAL_SETTINGS.focus,
  breakMin: INITIAL_SETTINGS.break,
  totalCycles: INITIAL_SETTINGS.cycles,
  currentCycle: 0,
  doneCycles: 0,
  onBreak: false,
  running: false,
  remaining: INITIAL_SETTINGS.focus * 60,
  total: INITIAL_SETTINGS.focus * 60,
  interval: null,

  // Spotify
  player: null,
  deviceId: null,
  playerReady: false,
  isPlaying: false,
  currentTrack: null,
  progressInterval: null,
  progressMs: 0,
  durationMs: 0,

  // Settings
  pauseOnBreak: INITIAL_SETTINGS.pauseOnBreak,
  autoMusic: INITIAL_SETTINGS.autoMusic,

  // Focus modes
  focusMode: null, // 'deep' | 'study' | 'creative' | null

  // Anti-distraction
  distractionCount: 0,
  pauseLocked: false,
};

const CIRC = 2 * Math.PI * 108; // svg ring circumference

// ── DOM Refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);
const iconSvg = (name, className = 'ui-icon') => `<svg class="${className}" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;

// ── Focus Modes ───────────────────────────────────────────────────────────────
function initFocusModes() {
  $$('.focus-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const modeKey = btn.dataset.mode;
      if (state.focusMode === modeKey) {
        // deactivate
        state.focusMode = null;
        state.pauseLocked = false;
        $$('.focus-mode-btn').forEach(b => b.classList.remove('focus-mode-btn--active'));
        updateModeIndicator(null);
        return;
      }
      const mode = FOCUS_MODES[modeKey];
      state.focusMode = modeKey;
      state.pauseLocked = mode.lockPause;
      state.focusMin = mode.focusMin;
      state.breakMin = mode.breakMin;
      $('focusInput').value = mode.focusMin;
      $('breakInput').value = mode.breakMin;
      $$('.focus-mode-btn').forEach(b => b.classList.remove('focus-mode-btn--active'));
      btn.classList.add('focus-mode-btn--active');
      $$('.preset').forEach(b => b.classList.remove('preset--active'));
      resetTimer();
      updateModeIndicator(modeKey);
      showBanner(`Modo ${mode.label} ativado`, mode.icon);
    });
  });
}

function updateModeIndicator(modeKey) {
  const el = $('modeIndicator');
  if (!el) return;
  if (!modeKey) { el.classList.add('hidden'); return; }
  const mode = FOCUS_MODES[modeKey];
  el.innerHTML = `${iconSvg(mode.icon)} <span>${mode.label}</span>`;
  el.classList.remove('hidden');
  el.className = `mode-indicator mode-indicator--${modeKey}`;
}

// ── Anti-Distraction ──────────────────────────────────────────────────────────
function initAntiDistraction() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.running && !state.onBreak) {
      state.distractionCount++;
      updateDistractionCounter();
    }
    if (!document.hidden && state.running && !state.onBreak) {
      showBanner(`Você saiu da aba! Distrações: ${state.distractionCount}`, 'eye');
    }
  });
}

function updateDistractionCounter() {
  const el = $('distractionCount');
  if (!el) return;
  el.textContent = state.distractionCount;
  $('distractionBadge').classList.toggle('hidden', state.distractionCount === 0);
}

// ── Smart Break ───────────────────────────────────────────────────────────────
function showBreakTip() {
  const existing = $('breakTipOverlay');
  if (existing) existing.remove();
  const tip = BREAK_TIPS[Math.floor(Math.random() * BREAK_TIPS.length)];
  const overlay = document.createElement('div');
  overlay.id = 'breakTipOverlay';
  overlay.className = 'break-tip-overlay';
  overlay.innerHTML = `
    <div class="break-tip-card">
      <div class="break-tip-icon">${iconSvg(tip.icon)}</div>
      <div class="break-tip-text">${tip.text}</div>
      <div class="break-tip-label">Sugestão de pausa</div>
      <button class="break-tip-close" onclick="document.getElementById('breakTipOverlay').remove()" aria-label="Fechar">${iconSvg('x')}</button>
    </div>
  `;
  document.body.appendChild(overlay);
  setTimeout(() => { const el = $('breakTipOverlay'); if (el) el.remove(); }, 6000);
}

// ── Navigation ────────────────────────────────────────────────────────────────
function initNav() {
  $$('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = btn.dataset.panel;
      $$('.nav-item').forEach(b => b.classList.remove('nav-item--active'));
      btn.classList.add('nav-item--active');
      $$('.panel').forEach(p => p.classList.remove('panel--active'));
      document.getElementById('panel-' + panel).classList.add('panel--active');

      if (panel !== 'pomodoro' && panel !== 'music' && state.isPlaying) {
        $('miniPlayer').classList.remove('hidden');
      } else {
        $('miniPlayer').classList.add('hidden');
      }

      if (panel === 'stats') loadStats();
      if (panel === 'music' && state.playerReady) loadPlaylists();
      if (panel === 'music' && !state.playerReady) initJamendoPanel();
      if (panel === 'goals') loadGoals();
      if (panel === 'missions') loadMissions();
      if (panel === 'schedule') initSchedule();
    });
  });
}

// ── Pomodoro Timer ────────────────────────────────────────────────────────────
function fmt(s) {
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

function updateTimerUI() {
  $('timerDisplay').textContent = fmt(state.remaining);
  const pct = state.remaining / state.total;
  $('ringProgress').style.strokeDasharray = CIRC;
  $('ringProgress').style.strokeDashoffset = CIRC * (1 - pct);

  if (state.onBreak) {
    $('ringProgress').classList.add('break-mode');
    $('phaseLabel').textContent = 'PAUSA';
    $('phaseLabel').classList.add('break-phase');
  } else {
    $('ringProgress').classList.remove('break-mode');
    $('phaseLabel').textContent = 'FOCO';
    $('phaseLabel').classList.remove('break-phase');
  }

  $('cycleCounter').textContent = `ciclo ${state.doneCycles + 1} de ${state.totalCycles}`;
}

function updateCycleDots() {
  const container = $('cycleDots');
  container.innerHTML = '';
  for (let i = 0; i < state.totalCycles; i++) {
    const dot = document.createElement('div');
    dot.className = 'cycle-dot' + (i < state.doneCycles ? ' done' : '');
    container.appendChild(dot);
  }
}

function playFocusMusic() {
  if (state.playerReady) spotifyPlay();
  else jmPlayForFocus();
}

function pauseFocusMusic() {
  if (state.playerReady) spotifyPause();
  else jmPause();
}

function startTimer() {
  if (state.running) return;
  state.running = true;
  $('startBtn').textContent = 'Pausar';
  $('startBtn').classList.add('running');

  // Show tasks overlay during focus
  if (!state.onBreak) {
    const overlay = document.getElementById('pomoTasksOverlay');
    if (overlay && !overlay.classList.contains('hidden') || true) {
      loadTasks().then(() => {
        const daily = tasksState.tasks.filter(t => t.period === 'daily');
        if (daily.length) document.getElementById('pomoTasksOverlay').classList.remove('hidden');
      });
    }
  }

  if (state.autoMusic && !state.onBreak) playFocusMusic();

  state.interval = setInterval(() => {
    state.remaining--;
    updateTimerUI();

    if (state.remaining <= 0) {
      playAlertSound();
      if (!state.onBreak) {
        // Focus ended → go to break
        state.doneCycles++;
        updateCycleDots();
        notifySession(1, state.focusMin);
        showMotivationalQuote();

        if (state.doneCycles >= state.totalCycles) {
          stopTimer();
          showBanner('Sessão completa!', 'trophy');
          return;
        }
        state.onBreak = true;
        state.total = state.remaining = state.breakMin * 60;
        if (state.pauseOnBreak) pauseFocusMusic();
        showBreakTip();
      } else {
        // Break ended → go to focus
        state.onBreak = false;
        state.total = state.remaining = state.focusMin * 60;
        if (state.autoMusic) playFocusMusic();
      }
      updateTimerUI();
    }
  }, 1000);
}

function pauseTimer() {
  if (state.pauseLocked && state.running && !state.onBreak) {
    showBanner('Pausa bloqueada no modo Deep Work!', 'target');
    return;
  }
  clearInterval(state.interval);
  state.running = false;
  $('startBtn').textContent = 'Retomar';
  $('startBtn').classList.remove('running');
}

function resetTimer() {
  clearInterval(state.interval);
  state.running = false;
  state.onBreak = false;
  state.doneCycles = 0;
  state.total = state.remaining = state.focusMin * 60;
  $('startBtn').textContent = 'Iniciar';
  $('startBtn').classList.remove('running');
  document.getElementById('pomoTasksOverlay').classList.add('hidden');
  updateTimerUI();
  updateCycleDots();
}

function stopTimer() {
  clearInterval(state.interval);
  state.running = false;
  state.onBreak = false;
  state.doneCycles = 0;
  state.total = state.remaining = state.focusMin * 60;
  $('startBtn').textContent = 'Iniciar';
  $('startBtn').classList.remove('running');
  updateTimerUI();
  updateCycleDots();
}

function playAlertSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    osc.start();
    osc.stop(ctx.currentTime + 0.8);
  } catch (e) {}
}

function showBanner(msg, iconName = null) {
  const div = document.createElement('div');
  div.className = 'flash flash--success';
  div.innerHTML = iconName ? `<span class="icon-label">${iconSvg(iconName)}<span>${escHtml(msg)}</span></span>` : escHtml(msg);
  div.style.cssText = 'position:fixed;top:16px;right:16px;z-index:999;';
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 4000);
}

async function notifySession(cycles, minutes, skipped = false) {
  try {
    const res = await fetch('/api/session/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cycles, focus_minutes: minutes, skipped }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'session_save_failed');
    }

    if (Array.isArray(data.missions)) {
      renderMissions(data.missions, data.total_xp || 0, data.max_xp || 90);
    } else {
      loadMissions();
    }

    if (document.getElementById('panel-stats')?.classList.contains('panel--active')) loadStats();
    if (document.getElementById('panel-goals')?.classList.contains('panel--active')) loadGoals();

    const completedKeys = data.completed_missions || [];
    if (completedKeys.length) {
      const mission = (data.missions || []).find(m => m.key === completedKeys[0]);
      if (mission) showBanner(`Missão concluída: ${mission.label}! +${mission.xp} XP`, mission.icon || 'trophy');
    }
  } catch (e) {
    console.error('Erro ao salvar ciclo:', e);
    showBanner('Não consegui salvar esse ciclo. Faça login novamente ou recarregue a página.', 'target');
  }
}

function initTimerControls() {
  $('startBtn').addEventListener('click', () => {
    state.running ? pauseTimer() : startTimer();
  });
  $('resetBtn').addEventListener('click', resetTimer);
  $('skipBtn').addEventListener('click', () => {
    clearInterval(state.interval);
    state.running = false;
    state.remaining = 0;
    if (!state.onBreak) {
      state.doneCycles++;
      updateCycleDots();
      notifySession(1, state.focusMin, true); // skipped = true
      state.onBreak = true;
      state.total = state.remaining = state.breakMin * 60;
      if (state.pauseOnBreak) pauseFocusMusic();
    } else {
      state.onBreak = false;
      state.total = state.remaining = state.focusMin * 60;
    }
    $('startBtn').textContent = 'Iniciar';
    $('startBtn').classList.remove('running');
    updateTimerUI();
  });

  // Presets
  $$('.preset').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.preset').forEach(b => b.classList.remove('preset--active'));
      btn.classList.add('preset--active');
      state.focusMin = parseInt(btn.dataset.focus);
      state.breakMin = parseInt(btn.dataset.break);
      $('focusInput').value = state.focusMin;
      $('breakInput').value = state.breakMin;
      resetTimer();
    });
  });

  // Number inputs
  $$('.num-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = $(btn.dataset.target);
      const delta = parseInt(btn.dataset.delta);
      const newVal = Math.max(parseInt(input.min), Math.min(parseInt(input.max), parseInt(input.value) + delta));
      input.value = newVal;
      applyInputChange(btn.dataset.target, newVal);
    });
  });
  ['focusInput', 'breakInput', 'cyclesInput'].forEach(id => {
    $(id) && $(id).addEventListener('change', () => applyInputChange(id, parseInt($(id).value)));
  });
}

function applyInputChange(id, val) {
  if (id === 'focusInput') { state.focusMin = val; $$('.preset').forEach(b => b.classList.remove('preset--active')); }
  if (id === 'breakInput') { state.breakMin = val; $$('.preset').forEach(b => b.classList.remove('preset--active')); }
  if (id === 'cyclesInput') { state.totalCycles = val; updateCycleDots(); }
  if (!state.running) resetTimer();
}

// Settings save
function initSettings() {
  $('saveSettings') && $('saveSettings').addEventListener('click', async () => {
    state.pauseOnBreak = $('pauseOnBreak').checked;
    state.autoMusic = $('autoMusic').checked;
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          focus_minutes: state.focusMin,
          break_minutes: state.breakMin,
          cycles: state.totalCycles,
          auto_music: state.autoMusic,
          pause_on_break: state.pauseOnBreak,
        }),
      });
      showBanner('Configurações salvas!');
    } catch (e) {}
  });
  $('pauseOnBreak') && $('pauseOnBreak').addEventListener('change', () => { state.pauseOnBreak = $('pauseOnBreak').checked; });
  $('autoMusic') && $('autoMusic').addEventListener('change', () => { state.autoMusic = $('autoMusic').checked; });
}

// ── Spotify Web Playback SDK ──────────────────────────────────────────────────
window.onSpotifyWebPlaybackSDKReady = () => {
  if (!SPOTIFY_TOKEN) return;

  state.player = new Spotify.Player({
    name: 'FOCO!',
    getOAuthToken: async cb => {
      try {
        const r = await fetch('/api/spotify/token');
        const d = await r.json();
        cb(d.token || SPOTIFY_TOKEN);
      } catch {
        cb(SPOTIFY_TOKEN);
      }
    },
    volume: 0.7,
  });

  state.player.addListener('ready', ({ device_id }) => {
    state.deviceId = device_id;
    state.playerReady = true;
    loadPlaylists();
  });

  state.player.addListener('player_state_changed', stateChange => {
    if (!stateChange) return;
    const track = stateChange.track_window.current_track;
    state.isPlaying = !stateChange.paused;
    state.progressMs = stateChange.position;
    state.durationMs = stateChange.duration;

    if (track) {
      state.currentTrack = track;
      updateNowPlaying(track);
      syncQmNowPlaying();
    }
    updatePlayBtn();
    updateQmPlayBtn();
    startProgressTracking();
  });

  state.player.connect();
};

function updateNowPlaying(track) {
  if (!track) return;
  const title = track.name;
  const artist = track.artists.map(a => a.name).join(', ');
  const images = track.album?.images;
  const imgUrl = images && images.length > 0 ? images[0].url : null;

  if ($('npTitle')) $('npTitle').textContent = title;
  if ($('npArtist')) $('npArtist').textContent = artist;
  if ($('npArt')) {
    if (imgUrl) {
      $('npArt').innerHTML = `<img src="${imgUrl}" alt="${title}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">`;
    } else {
      $('npArt').innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
    }
  }
  if ($('mpTitle')) $('mpTitle').textContent = title;
}

function updatePlayBtn() {
  const icon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">`;
  const pauseIcon = icon + `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
  const playIcon = icon + `<polygon points="5 3 19 12 5 21"/></svg>`;
  if ($('playBtn')) $('playBtn').innerHTML = state.isPlaying ? pauseIcon : playIcon;
  if ($('mpPlay')) $('mpPlay').innerHTML = state.isPlaying ? '⏸' : '▶';
}

function startProgressTracking() {
  clearInterval(state.progressInterval);
  if (!state.isPlaying) return;
  state.progressInterval = setInterval(() => {
    state.progressMs += 1000;
    if (state.durationMs > 0) {
      const pct = Math.min(100, (state.progressMs / state.durationMs) * 100);
      if ($('npFill')) $('npFill').style.width = pct + '%';
    }
  }, 1000);
}

async function spotifyPlay(uri) {
  if (!state.playerReady || !state.deviceId) return;
  try {
    const token = await getToken();
    const body = uri ? { context_uri: uri } : {};
    await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${state.deviceId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {}
}

async function spotifyPause() {
  if (!state.playerReady) return;
  try { await state.player.pause(); } catch (e) {}
}

async function spotifyPlayTrack(uri) {
  if (!state.playerReady || !state.deviceId) return;
  try {
    const token = await getToken();
    await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${state.deviceId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [uri] }),
    });
  } catch (e) {}
}

async function getToken() {
  try {
    const r = await fetch('/api/spotify/token');
    const d = await r.json();
    return d.token;
  } catch { return SPOTIFY_TOKEN; }
}

function initPlayerControls() {
  $('playBtn') && $('playBtn').addEventListener('click', () => {
    if (state.isPlaying) spotifyPause();
    else spotifyPlay();
  });
  $('prevBtn') && $('prevBtn').addEventListener('click', () => state.player?.previousTrack());
  $('nextBtn') && $('nextBtn').addEventListener('click', () => state.player?.nextTrack());
  $('mpPlay') && $('mpPlay').addEventListener('click', () => {
    if (state.isPlaying) spotifyPause();
    else spotifyPlay();
  });
  $('mpPrev') && $('mpPrev').addEventListener('click', () => state.player?.previousTrack());
  $('mpNext') && $('mpNext').addEventListener('click', () => state.player?.nextTrack());

  $('volSlider') && $('volSlider').addEventListener('input', function () {
    const vol = this.value / 100;
    if ($('volDisplay')) $('volDisplay').textContent = this.value + '%';
    state.player?.setVolume(vol);
  });
}

// ── Search ────────────────────────────────────────────────────────────────────
function initSearch() {
  const doSearch = async () => {
    const q = $('searchInput')?.value.trim();
    if (!q) return;
    const [tracksRes, playlistsRes] = await Promise.all([
      fetch('/api/spotify/search?q=' + encodeURIComponent(q)),
      fetch('/api/spotify/search_playlists?q=' + encodeURIComponent(q)),
    ]);
    const tracksData = await tracksRes.json();
    const playlistsData = await playlistsRes.json();
    renderSearchResults(tracksData.tracks || [], playlistsData.playlists || []);
  };
  $('searchBtn') && $('searchBtn').addEventListener('click', doSearch);
  $('searchInput') && $('searchInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch();
  });
}

function renderSearchResults(tracks, playlists) {
  const container = $('searchResults');
  if (!container) return;
  let html = '';

  if (tracks.length) {
    html += '<div class="search-section-title">Músicas</div>';
    html += tracks.map(t => `
      <div class="track-item" data-uri="${t.uri}">
        <div class="track-thumb">${t.image ? `<img src="${t.image}" alt="">` : ''}</div>
        <div class="track-meta">
          <div class="track-name">${t.name}</div>
          <div class="track-artist-name">${t.artist}</div>
        </div>
        <div class="track-dur">${msToMin(t.duration_ms)}</div>
      </div>
    `).join('');
  }

  if (playlists.length) {
    html += '<div class="search-section-title">Playlists</div>';
    html += playlists.map(p => `
      <div class="track-item pl-search-item" data-uri="${p.uri}">
        <div class="track-thumb">${p.image ? `<img src="${p.image}" alt="">` : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`}</div>
        <div class="track-meta">
          <div class="track-name">${p.name}</div>
        </div>
        <div class="track-dur">▶</div>
      </div>
    `).join('');
  }

  if (!html) {
    container.innerHTML = '<div class="loading-text">Nenhum resultado.</div>';
  } else {
    container.innerHTML = html;
    container.querySelectorAll('.track-item:not(.pl-search-item)').forEach(el => {
      el.addEventListener('click', () => spotifyPlayTrack(el.dataset.uri));
    });
    container.querySelectorAll('.pl-search-item').forEach(el => {
      el.addEventListener('click', () => spotifyPlay(el.dataset.uri));
    });
  }
  container.classList.remove('hidden');
}

function renderTracks(tracks, container) {
  if (!container) return;
  if (!tracks.length) {
    container.innerHTML = '<div class="loading-text">Nenhuma música.</div>';
    return;
  }
  container.innerHTML = tracks.map(t => `
    <div class="track-item" data-uri="${t.uri}">
      <div class="track-thumb">${t.image ? `<img src="${t.image}" alt="">` : ''}</div>
      <div class="track-meta">
        <div class="track-name">${t.name}</div>
        <div class="track-artist-name">${t.artist}</div>
      </div>
      <div class="track-dur">${msToMin(t.duration_ms)}</div>
    </div>
  `).join('');
  container.querySelectorAll('.track-item').forEach(el => {
    el.addEventListener('click', () => spotifyPlayTrack(el.dataset.uri));
  });
}

function msToMin(ms) {
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

// ── Playlists ─────────────────────────────────────────────────────────────────
async function loadPlaylists() {
  const container = $('playlists');
  if (!container) return;
  try {
    const res = await fetch('/api/spotify/playlists');
    const data = await res.json();
    if (!data.playlists.length) {
      container.innerHTML = '<div class="loading-text">Nenhuma playlist encontrada.</div>';
      return;
    }
    container.innerHTML = data.playlists.map(p => `
      <div class="pl-card" data-uri="${p.uri}">
        <div class="pl-thumb">${p.image ? `<img src="${p.image}" alt="">` : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`}</div>
        <div class="pl-meta">
          <div class="pl-name">${p.name}</div>
        </div>
      </div>
    `).join('');
    container.querySelectorAll('.pl-card').forEach(el => {
      el.addEventListener('click', () => spotifyPlay(el.dataset.uri));
    });
  } catch (e) {
    if (container) container.innerHTML = '<div class="loading-text">Erro ao carregar.</div>';
  }
}

async function openPlaylistModal(playlistId, playlistName, playlistUri) {
  // Remove existing modal
  const existing = document.getElementById('playlistModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'playlistModal';
  modal.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:1000;display:flex;align-items:center;justify-content:center;
  `;
  modal.innerHTML = `
    <div style="background:var(--surface,#1a1a2e);border-radius:12px;width:min(520px,92vw);max-height:80vh;display:flex;flex-direction:column;overflow:hidden;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border,#2a2a3e);">
        <div>
          <div style="font-weight:600;font-size:15px;">${playlistName}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button id="playAllBtn" style="background:#1DB954;color:#000;border:none;border-radius:6px;padding:6px 14px;cursor:pointer;font-weight:600;font-size:13px;">▶ Tocar tudo</button>
          <button id="closeModal" style="background:none;border:none;color:var(--text-muted,#888);font-size:20px;cursor:pointer;line-height:1;" aria-label="Fechar">${iconSvg('x')}</button>
        </div>
      </div>
      <div id="modalTracks" style="overflow-y:auto;flex:1;padding:8px 0;">
        <div class="loading-text" style="padding:20px;text-align:center;">Carregando...</div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector('#closeModal').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  modal.querySelector('#playAllBtn').addEventListener('click', () => {
    spotifyPlay(playlistUri);
    modal.remove();
  });

  try {
    const res = await fetch(`/api/spotify/playlist/${playlistId}/tracks`);
    const data = await res.json();
    const trackContainer = modal.querySelector('#modalTracks');
    renderTracks(data.tracks || [], trackContainer);
    trackContainer.querySelectorAll('.track-item').forEach(el => {
      el.addEventListener('click', () => { spotifyPlayTrack(el.dataset.uri); modal.remove(); });
    });
  } catch (e) {
    modal.querySelector('#modalTracks').innerHTML = '<div class="loading-text" style="padding:20px;">Erro ao carregar músicas.</div>';
  }
}

// ── Stats ─────────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const res = await fetch('/api/stats/insights');
    const data = await res.json();
    renderStats(data);
  } catch (e) {
    // fallback
    try {
      const res2 = await fetch('/api/stats');
      const data2 = await res2.json();
      renderStats({ sessions: data2.sessions, total_minutes_7d: 0, total_cycles_7d: 0, streak: 0, insight: null, hourly: [] });
    } catch {}
  }
}

function renderStats(data) {
  const grid = $('statsGrid');
  const chart = $('statsChart');
  if (!grid || !chart) return;

  const sessions = data.sessions || [];
  const totalCycles = data.total_cycles_7d ?? sessions.reduce((a, s) => a + s.cycles, 0);
  const totalMin = data.total_minutes_7d ?? sessions.reduce((a, s) => a + s.minutes, 0);
  const streak = data.streak ?? 0;

  grid.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Ciclos (7 dias)</div>
      <div class="stat-value">${totalCycles}</div>
      <div class="stat-sub">${(totalMin/60).toFixed(1)}h focadas</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Sequência atual</div>
      <div class="stat-value icon-label">${iconSvg('flame')}<span>${streak}</span></div>
      <div class="stat-sub">dia${streak !== 1 ? 's' : ''} seguido${streak !== 1 ? 's' : ''}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Melhor horário</div>
      <div class="stat-value">${data.best_hour_label ?? '-'}</div>
      <div class="stat-sub">${data.insight ?? 'Complete mais ciclos'}</div>
    </div>
  `;

  if (data.insight) {
    const insightDiv = document.createElement('div');
    insightDiv.className = 'stats-insight';
    insightDiv.innerHTML = `<span class="insight-bulb">${iconSvg('lightbulb')}</span> ${escHtml(data.insight)}`;
    grid.appendChild(insightDiv);
  }

  // Hourly heatmap
  const hourly = data.hourly || [];
  if (hourly.length) {
    const maxMin = Math.max(...hourly.map(h => h.minutes), 1);
    const heatHtml = Array.from({length: 24}, (_, i) => {
      const h = hourly.find(x => x.hour === i);
      const pct = h ? Math.round((h.minutes / maxMin) * 100) : 0;
      const isHot = h && h.hour === data.best_hour;
      return `<div class="heat-cell${isHot ? ' heat-cell--best' : ''}" style="opacity:${0.1 + pct/110}" title="${i}:00 — ${h ? h.minutes : 0} min">
        <span class="heat-hour">${i}</span>
      </div>`;
    }).join('');
    chart.innerHTML = `<div class="heat-title">Foco por hora do dia</div><div class="heat-grid">${heatHtml}</div>`;
  } else if (!sessions.length) {
    chart.innerHTML = '<div class="loading-text">Sem dados ainda. Complete um ciclo!</div>';
    return;
  } else {
    // Bar chart fallback
    const maxCycles = Math.max(...sessions.map(s => s.cycles), 1);
    const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const reversed = [...sessions].reverse();
    chart.innerHTML = '<div class="heat-title">Ciclos por dia (7 dias)</div>' + `<div class="bar-chart-wrap">${reversed.map(s => {
      const h = Math.round((s.cycles / maxCycles) * 100);
      const d = new Date(s.date + 'T12:00:00');
      return `<div class="bar-wrap"><div class="bar-fill" style="height:${h}px"></div><div class="bar-label">${days[d.getDay()]}</div></div>`;
    }).join('')}</div>`;
  }
}

// ── Missions ──────────────────────────────────────────────────────────────────
let _noSkipEarned = false;

async function checkMissionNoSkip(skipped) {
  if (skipped || _noSkipEarned) return;
  _noSkipEarned = true;
  try {
    await fetch('/api/missions/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'no_skip' }),
    });
    showBanner('Missão desbloqueada: Ciclo sem pular! +20 XP', 'target');
  } catch {}
}

async function loadMissions() {
  const container = $('missionsList');
  const xpBar = $('xpBar');
  const xpLabel = $('xpLabel');
  if (!container) return;
  try {
    const res = await fetch('/api/missions');
    const data = await res.json();
    renderMissions(data.missions || [], data.total_xp || 0, data.max_xp || 90);
  } catch (e) {
    if (container) container.innerHTML = '<div class="loading-text">Erro ao carregar missões.</div>';
  }
}

function renderMissions(missions, totalXp, maxXp) {
  const container = $('missionsList');
  const xpBar = $('xpBar');
  const xpLabel = $('xpLabel');
  if (!container) return;

  if (xpBar) xpBar.style.width = Math.round((totalXp / maxXp) * 100) + '%';
  if (xpLabel) xpLabel.textContent = `${totalXp} / ${maxXp} XP`;

  container.innerHTML = missions.map(m => `
    <div class="mission-card${m.completed ? ' mission-card--done' : ''}">
      <div class="mission-icon">${iconSvg(m.icon || 'target')}</div>
      <div class="mission-info">
        <div class="mission-label">${m.label}</div>
        <div class="mission-xp">+${m.xp} XP</div>
      </div>
      <div class="mission-status">${m.completed ? iconSvg('check') : iconSvg('circle')}</div>
    </div>
  `).join('');
}

// ── Goals ─────────────────────────────────────────────────────────────────────
let goalFormType = 'minutes';

async function loadGoals() {
  const container = $('goalsList');
  if (!container) return;
  try {
    const res = await fetch('/api/goals');
    const data = await res.json();
    renderGoals(data.goals || []);
  } catch (e) {
    if (container) container.innerHTML = '<div class="loading-text">Erro ao carregar metas.</div>';
  }
}

function renderGoals(goals) {
  const container = $('goalsList');
  if (!container) return;
  if (!goals.length) {
    container.innerHTML = '<div class="loading-text">Nenhuma meta definida. Crie uma acima!</div>';
    return;
  }
  container.innerHTML = goals.map(g => {
    const pct = Math.min(100, Math.round((g.current / g.target) * 100));
    const label = g.type === 'minutes' ? 'min de foco' : 'pomodoros';
    const icon = g.type === 'minutes' ? 'timer' : 'rotate';
    const streakText = g.streak > 0 ? `${g.streak} dia${g.streak > 1 ? 's' : ''} seguido${g.streak > 1 ? 's' : ''}` : '';
    const doneClass = g.done ? ' goal-card--done' : '';
    return `
      <div class="goal-card${doneClass}" data-id="${g.id}">
        <div class="goal-card-top">
          <div class="goal-info">
            <span class="goal-icon">${iconSvg(g.done ? 'check' : icon)}</span>
            <span class="goal-title">${g.current} / ${g.target} ${label}</span>
          </div>
          <div class="goal-right">
            ${streakText ? `<span class="goal-streak">${iconSvg('flame')} ${streakText}</span>` : ''}
            <button class="goal-delete" data-id="${g.id}" title="Remover">${iconSvg('x')}</button>
          </div>
        </div>
        <div class="goal-bar-wrap">
          <div class="goal-bar-fill" style="width:${pct}%"></div>
        </div>
        <div class="goal-pct">${pct}%</div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.goal-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      await fetch(`/api/goals/${id}`, { method: 'DELETE' });
      loadGoals();
    });
  });
}

function initGoals() {
  const openBtn = $('openGoalForm');
  const form = $('goalForm');
  const cancelBtn = $('cancelGoalForm');
  const saveBtn = $('saveGoal');
  const targetInput = $('goalTarget');
  const unitLabel = $('goalUnit');

  if (!openBtn) return;

  openBtn.addEventListener('click', () => {
    form.classList.toggle('hidden');
  });
  cancelBtn.addEventListener('click', () => form.classList.add('hidden'));

  $$('.goal-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.goal-type-btn').forEach(b => b.classList.remove('goal-type-btn--active'));
      btn.classList.add('goal-type-btn--active');
      goalFormType = btn.dataset.type;
      unitLabel.textContent = goalFormType === 'minutes' ? 'minutos' : 'pomodoros';
      targetInput.value = goalFormType === 'minutes' ? '120' : '4';
    });
  });

  saveBtn.addEventListener('click', async () => {
    const target = parseInt(targetInput.value);
    if (!target || target <= 0) return;
    await fetch('/api/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: goalFormType, target }),
    });
    form.classList.add('hidden');
    loadGoals();
  });
}

// ── Pomo Tabs ─────────────────────────────────────────────────────────────────
function initPomoTabs() {
  $$('.pomo-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.pomo-tab').forEach(b => b.classList.remove('pomo-tab--active'));
      btn.classList.add('pomo-tab--active');
      const tab = btn.dataset.tab;
      $$('.pomo-tab-panel').forEach(p => p.classList.add('hidden'));
      const panel = document.getElementById('pomo-tab-' + tab);
      if (panel) panel.classList.remove('hidden');
      if (tab === 'quickmusic') initQuickMusic();
      if (tab === 'quickjamendo') initQuickJamendo();
    });
  });
}

// ── Quick Music (timer panel) ─────────────────────────────────────────────────
let qmLoaded = false;

function initQuickMusic() {
  if (!$('qmSearchInput')) return;

  // sync now playing
  syncQmNowPlaying();

  // playlists (load once)
  if (!qmLoaded) {
    qmLoaded = true;
    loadQmPlaylists();
  }

  // controls
  $('qmPlay') && $('qmPlay').addEventListener('click', () => {
    if (state.isPlaying) spotifyPause(); else spotifyPlay();
  });
  $('qmPrev') && $('qmPrev').addEventListener('click', () => state.player?.previousTrack());
  $('qmNext') && $('qmNext').addEventListener('click', () => state.player?.nextTrack());

  const doQmSearch = async () => {
    const q = $('qmSearchInput')?.value.trim();
    if (!q) return;
    $('qmResults').innerHTML = '<div class="loading-text" style="font-size:12px;padding:6px 0;">Buscando...</div>';
    $('qmResults').classList.remove('hidden');
    const [tr, pr] = await Promise.all([
      fetch('/api/spotify/search?q=' + encodeURIComponent(q)),
      fetch('/api/spotify/search_playlists?q=' + encodeURIComponent(q)),
    ]);
    const td = await tr.json();
    const pd = await pr.json();
    renderQmResults((td.tracks || []).slice(0, 4), (pd.playlists || []).slice(0, 3));
  };
  $('qmSearchBtn').onclick = doQmSearch;
  $('qmSearchInput').onkeydown = e => { if (e.key === 'Enter') doQmSearch(); };
}

function syncQmNowPlaying() {
  if (!state.currentTrack) return;
  const t = state.currentTrack;
  if ($('qmTitle')) $('qmTitle').textContent = t.name;
  if ($('qmArtist')) $('qmArtist').textContent = t.artists?.map(a => a.name).join(', ') || '';
  const img = t.album?.images?.[0]?.url;
  if ($('qmArt')) $('qmArt').innerHTML = img
    ? `<img src="${img}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
  updateQmPlayBtn();
}

function updateQmPlayBtn() {
  if (!$('qmPlay')) return;
  $('qmPlay').innerHTML = state.isPlaying
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>`;
}

async function loadQmPlaylists() {
  const c = $('qmPlaylists');
  if (!c) return;
  try {
    const res = await fetch('/api/spotify/playlists');
    const data = await res.json();
    const pls = (data.playlists || []).slice(0, 6);
    if (!pls.length) { c.innerHTML = '<div class="loading-text" style="font-size:12px;">Nenhuma playlist.</div>'; return; }
    c.innerHTML = pls.map(p => `
      <div class="qm-pl-item" data-uri="${p.uri}">
        <div class="qm-pl-thumb">${p.image ? `<img src="${p.image}" alt="">` : iconSvg('music')}</div>
        <div class="qm-pl-name">${p.name}</div>
      </div>
    `).join('');
    c.querySelectorAll('.qm-pl-item').forEach(el => {
      el.addEventListener('click', () => spotifyPlay(el.dataset.uri));
    });
  } catch {}
}

function renderQmResults(tracks, playlists) {
  const c = $('qmResults');
  if (!c) return;
  let html = '';
  tracks.forEach(t => {
    html += `<div class="qm-result-item" data-uri="${t.uri}" data-type="track">
      <div class="qm-r-thumb">${t.image ? `<img src="${t.image}" alt="">` : iconSvg('music')}</div>
      <div class="qm-r-meta"><div class="qm-r-name">${t.name}</div><div class="qm-r-sub">${t.artist}</div></div>
    </div>`;
  });
  playlists.forEach(p => {
    html += `<div class="qm-result-item" data-uri="${p.uri}" data-type="playlist">
      <div class="qm-r-thumb">${p.image ? `<img src="${p.image}" alt="">` : iconSvg('list')}</div>
      <div class="qm-r-meta"><div class="qm-r-name">${p.name}</div><div class="qm-r-sub">playlist</div></div>
    </div>`;
  });
  if (!html) html = '<div class="loading-text" style="font-size:12px;padding:6px 0;">Sem resultados.</div>';
  c.innerHTML = html;
  c.querySelectorAll('.qm-result-item').forEach(el => {
    el.addEventListener('click', () => {
      if (el.dataset.type === 'track') spotifyPlayTrack(el.dataset.uri);
      else spotifyPlay(el.dataset.uri);
      $('qmResults').classList.add('hidden');
      $('qmSearchInput').value = '';
    });
  });
}

// ── Motivational Quote ────────────────────────────────────────────────────────
// Quick Jamendo (timer panel)
let jqInited = false;
let jqLoaded = false;

function initQuickJamendo() {
  if (!$('jqPlay')) return;

  jqSyncNowPlaying();

  if (!jqInited) {
    jqInited = true;
    $('jqPlay') && $('jqPlay').addEventListener('click', jmToggle);
    $('jqPrev') && $('jqPrev').addEventListener('click', jmPrev);
    $('jqNext') && $('jqNext').addEventListener('click', jmNext);

    const doJqSearch = async () => {
      const q = $('jqSearchInput')?.value.trim();
      if (!q) return;
      const results = $('jqResults');
      if (results) {
        results.innerHTML = '<div class="loading-text" style="font-size:12px;padding:6px 0;">Buscando...</div>';
        results.classList.remove('hidden');
      }
      try {
        const tracks = await jmSearch(q);
        renderJqResults(tracks.slice(0, 6));
      } catch (e) {
        if (results) results.innerHTML = `<div class="loading-text jm-error-text">${escHtml(e.message)}</div>`;
      }
    };
    $('jqSearchBtn') && ($('jqSearchBtn').onclick = doJqSearch);
    $('jqSearchInput') && ($('jqSearchInput').onkeydown = e => { if (e.key === 'Enter') doJqSearch(); });
  }

  if (!jqLoaded) {
    jqLoaded = true;
    loadJqPlaylists();
  }

  if (!jamendo.queue.length) jmLoadPlaylist(jamendo.currentTag || 'study', false);
}

async function loadJqPlaylists() {
  const c = $('jqPlaylists');
  if (!c) return;
  try {
    const res = await fetch('/api/jamendo/playlists');
    const data = await res.json();
    const playlists = (data.playlists || []).slice(0, 6);
    if (!playlists.length) {
      c.innerHTML = '<div class="loading-text" style="font-size:12px;">Nenhuma curadoria.</div>';
      return;
    }
    c.innerHTML = playlists.map(p => `
      <div class="qm-pl-item jq-pl-item" data-tag="${escHtml(p.tag)}">
        <div class="qm-pl-thumb">${iconSvg('headphones')}</div>
        <div class="qm-pl-name">${escHtml(p.name)}</div>
      </div>
    `).join('');
    c.querySelectorAll('.jq-pl-item').forEach(el => {
      el.addEventListener('click', () => {
        jqSetActivePlaylist(el.dataset.tag);
        jmLoadPlaylist(el.dataset.tag, true);
      });
    });
    jqSetActivePlaylist(jamendo.currentTag || playlists[0].tag);
  } catch {
    c.innerHTML = '<div class="loading-text jm-error-text" style="font-size:12px;">Erro ao carregar Jamendo.</div>';
  }
}

function jqSetActivePlaylist(tag) {
  document.querySelectorAll('.jq-pl-item').forEach(el => {
    el.classList.toggle('jq-pl-item--active', el.dataset.tag === tag);
  });
}

function jqSyncNowPlaying(track = jamendo.queue[jamendo.idx]) {
  if (!$('jqTitle')) return;
  if (!track) {
    $('jqTitle').textContent = 'Jamendo Focus';
    $('jqArtist').textContent = 'Selecione uma curadoria';
    $('jqArt').innerHTML = iconSvg('headphones');
    return;
  }
  $('jqTitle').textContent = track.name || 'Sem titulo';
  $('jqArtist').textContent = track.artist || 'Jamendo';
  $('jqArt').innerHTML = track.image
    ? `<img src="${track.image}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">`
    : iconSvg('headphones');
  jqSetActivePlaylist(jamendo.currentTag);
}

function renderJqResults(tracks) {
  const c = $('jqResults');
  if (!c) return;
  if (!tracks.length) {
    c.innerHTML = '<div class="loading-text" style="font-size:12px;padding:6px 0;">Sem resultados.</div>';
    return;
  }
  c.innerHTML = tracks.map((t, i) => `
    <div class="qm-result-item jq-result-item" data-idx="${i}">
      <div class="qm-r-thumb">${t.image ? `<img src="${t.image}" alt="">` : iconSvg('music')}</div>
      <div class="qm-r-meta"><div class="qm-r-name">${escHtml(t.name)}</div><div class="qm-r-sub">${escHtml(t.artist)}</div></div>
    </div>
  `).join('');
  c.querySelectorAll('.jq-result-item').forEach((el, i) => {
    el.addEventListener('click', () => {
      jmPlayTrackFromList(tracks, i);
      c.classList.add('hidden');
      if ($('jqSearchInput')) $('jqSearchInput').value = '';
    });
  });
}

const FALLBACK_QUOTES = [
  'Cada ciclo concluído é um passo a mais em direção ao seu objetivo.',
  'Foco é a arte de dizer não para mil coisas boas para dizer sim à essencial.',
  'Você não precisa ser perfeito, precisa ser consistente.',
  'A disciplina de hoje é a liberdade de amanhã.',
  'Pequenos progressos todos os dias resultam em grandes conquistas.',
  'Você está mais perto do que estava ontem.',
  'O sucesso é a soma de pequenos esforços repetidos dia após dia.',
  'Descanse, respire — você mereceu essa pausa.',
];

async function showMotivationalQuote() {
  // Show overlay immediately with loading state
  const overlay = document.createElement('div');
  overlay.id = 'motivOverlay';
  overlay.className = 'motiv-overlay';
  overlay.innerHTML = `
    <div class="motiv-card">
      <div class="motiv-icon">${iconSvg('target')}</div>
      <div class="motiv-quote" id="motivQuoteText"><span class="motiv-loading">...</span></div>
      <button class="motiv-close" onclick="document.getElementById('motivOverlay').remove()">Continuar</button>
    </div>
  `;
  document.body.appendChild(overlay);

  let quote = FALLBACK_QUOTES[Math.floor(Math.random() * FALLBACK_QUOTES.length)];

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 120,
        messages: [{
          role: 'user',
          content: 'Gere UMA frase motivacional curta e poderosa (máximo 20 palavras) em português do Brasil para alguém que acabou de completar um ciclo de foco Pomodoro. Responda APENAS com a frase, sem aspas, sem explicação.',
        }],
      }),
    });
    const data = await res.json();
    const text = data?.content?.[0]?.text?.trim();
    if (text && text.length > 5) quote = text;
  } catch {}

  const el = document.getElementById('motivQuoteText');
  if (el) el.textContent = quote;
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initFocusModes();
  initAntiDistraction();
  initPomoTabs();
  updateTimerUI();
  updateCycleDots();
  initTimerControls();
  initSettings();
  initGoals();
  loadMissions(); // preload for badge counts
  initTasks();

  if (SPOTIFY_TOKEN) {
    initPlayerControls();
    initSearch();
    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    document.head.appendChild(script);
  }

  if ($('jqPlay')) initQuickJamendo();
});
// ── Tasks ─────────────────────────────────────────────────────────────────────

let tasksState = { period: 'daily', category: '', tasks: [] };

function initTasks() {
  // Open/close form
  document.getElementById('openTaskForm').addEventListener('click', () => {
    document.getElementById('taskForm').classList.remove('hidden');
    document.getElementById('taskTitleInput').focus();
  });
  document.getElementById('cancelTaskForm').addEventListener('click', () => {
    document.getElementById('taskForm').classList.add('hidden');
    document.getElementById('taskTitleInput').value = '';
  });

  // Save task
  document.getElementById('saveTask').addEventListener('click', saveTask);
  document.getElementById('taskTitleInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveTask();
  });

  // Period filter
  document.querySelectorAll('.task-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.task-filter-btn').forEach(b => b.classList.remove('task-filter-btn--active'));
      btn.classList.add('task-filter-btn--active');
      tasksState.period = btn.dataset.period;
      loadTasks();
    });
  });

  // Category filter
  document.querySelectorAll('.task-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.task-cat-btn').forEach(b => b.classList.remove('task-cat-btn--active'));
      btn.classList.add('task-cat-btn--active');
      tasksState.category = btn.dataset.cat;
      loadTasks();
    });
  });

  loadTasks();
}

async function loadTasks() {
  const params = new URLSearchParams({ period: tasksState.period });
  if (tasksState.category) params.set('category', tasksState.category);
  const res = await fetch('/api/tasks?' + params);
  const data = await res.json();
  tasksState.tasks = data.tasks;
  renderTasks(data.tasks, data.progress);
  renderPomoTasksMini(data.tasks);
}

function renderTasks(tasks, progress) {
  const list = document.getElementById('tasksList');
  const bar = document.getElementById('tasksProgressBar');
  const pct = document.getElementById('tasksProgressPct');
  const label = document.getElementById('tasksProgressLabel');

  const p = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  bar.style.width = p + '%';
  pct.textContent = p + '%';
  const periodLabel = { daily: 'hoje', weekly: 'esta semana', monthly: 'este mês' }[tasksState.period] || '';
  label.textContent = `${progress.done} de ${progress.total} concluídas ${periodLabel}`;

  if (!tasks.length) {
    list.innerHTML = `<div class="task-empty">${iconSvg('target')}<span>Nenhuma tarefa. Adicione uma.</span></div>`;
    return;
  }

  // Sort: pending first, done last
  const sorted = [...tasks].sort((a, b) => a.completed - b.completed);

  list.innerHTML = sorted.map(t => {
    const catLabels = {
      pessoal: `${iconSvg('user')} Pessoal`,
      estudo: `${iconSvg('book')} Estudo`,
      trabalho: `${iconSvg('briefcase')} Trabalho`,
    };
    const periodLabels = { daily: 'Hoje', weekly: 'Semana', monthly: 'Mês' };
    return `
    <div class="task-item ${t.completed ? 'task-item--done' : ''}" data-id="${t.id}">
      <div class="task-check ${t.completed ? 'task-check--done' : ''}" onclick="toggleTask(${t.id}, ${!t.completed})"></div>
      <div class="task-body">
        <div class="task-title-text">${escHtml(t.title)}</div>
        <div class="task-meta">
          <span class="task-tag task-tag--${t.category}">${catLabels[t.category] || escHtml(t.category)}</span>
          <span class="task-tag">${periodLabels[t.period] || t.period}</span>
        </div>
      </div>
      <div class="task-actions">
        <button class="task-action-btn" onclick="deleteTask(${t.id})" title="Deletar">${iconSvg('trash')}</button>
      </div>
    </div>`;
  }).join('');
}

function renderPomoTasksMini(tasks) {
  const overlay = document.getElementById('pomoTasksOverlay');
  const mini = document.getElementById('pomoTasksMini');
  const daily = tasks.filter(t => t.period === 'daily').slice(0, 5);
  if (!daily.length) { overlay.classList.add('hidden'); return; }
  mini.innerHTML = daily.map(t => `
    <div class="pto-item">
      <div class="pto-check ${t.completed ? 'pto-check--done' : ''}"></div>
      <span class="${t.completed ? 'pto-title-text--done' : ''}">${escHtml(t.title)}</span>
    </div>`).join('');
}

async function saveTask() {
  const title = document.getElementById('taskTitleInput').value.trim();
  if (!title) return;
  const category = document.getElementById('taskCategory').value;
  const period = document.getElementById('taskPeriod').value;
  await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, category, period }),
  });
  document.getElementById('taskTitleInput').value = '';
  document.getElementById('taskForm').classList.add('hidden');
  loadTasks();
}

async function toggleTask(id, completed) {
  await fetch(`/api/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ completed }),
  });
  loadTasks();
}

async function deleteTask(id) {
  await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
  loadTasks();
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Jamendo Player ────────────────────────────────────────────────────────────
const jamendo = {
  audio:      null,
  queue:      [],
  idx:        0,
  isPlaying:  false,
  currentTag: 'study',
};

function jmInit() {
  if (jamendo.audio) return;
  jamendo.audio = new Audio();
  jamendo.audio.volume = 0.7;
  jamendo.audio.crossOrigin = 'anonymous';
  jamendo.audio.addEventListener('ended', () => jmNext());
  jamendo.audio.addEventListener('timeupdate', () => {
    const dur = jamendo.audio.duration || 0;
    const cur = jamendo.audio.currentTime || 0;
    const pct = dur ? (cur / dur) * 100 : 0;
    document.querySelectorAll('.jm-progress-fill').forEach(el => el.style.width = pct + '%');
    document.querySelectorAll('.jm-time').forEach(el =>
      el.textContent = jmFmtTime(cur) + ' / ' + jmFmtTime(dur));
  });
  jamendo.audio.addEventListener('play',  () => { jamendo.isPlaying = true;  jmSyncUI(); });
  jamendo.audio.addEventListener('pause', () => { jamendo.isPlaying = false; jmSyncUI(); });
  jamendo.audio.addEventListener('error', () => setTimeout(jmNext, 1000));
}

function jmFmtTime(s) {
  if (!s || isNaN(s)) return '0:00';
  return Math.floor(s/60) + ':' + String(Math.floor(s%60)).padStart(2,'0');
}

function jmSetPlaylistLabel(text, isError = false) {
  const label = document.getElementById('jmPlaylistLabel');
  if (!label) return;
  label.textContent = text;
  label.classList.toggle('jm-current-tag--error', isError);
}

function jmSetNowPlayingText(title, artist = '') {
  document.querySelectorAll('.jm-np-art').forEach(el => { el.innerHTML = iconSvg('headphones'); });
  document.querySelectorAll('.jm-np-title').forEach(el => { el.textContent = title; });
  document.querySelectorAll('.jm-np-artist').forEach(el => { el.textContent = artist || '-'; });
  document.querySelectorAll('.jm-progress-fill').forEach(el => { el.style.width = '0%'; });
  document.querySelectorAll('.jm-time').forEach(el => { el.textContent = '0:00 / 0:00'; });
  if ($('jqTitle')) {
    $('jqArt').innerHTML = iconSvg('headphones');
    $('jqTitle').textContent = title;
    $('jqArtist').textContent = artist || '-';
  }
}

function jmRenderQueue() {
  const qEl = document.getElementById('jmQueueList');
  if (!qEl) return;
  if (!jamendo.queue.length) {
    qEl.innerHTML = '<div class="loading-text">Nenhuma fila carregada.</div>';
    return;
  }
  qEl.innerHTML = jamendo.queue.map((t, i) => `
    <div class="jm-track-item ${i === jamendo.idx ? 'jm-track-item--active' : ''}" data-idx="${i}">
      <div class="jm-track-art">${t.image ? `<img src="${t.image}" alt="">` : iconSvg('music')}</div>
      <div class="jm-track-meta">
        <div class="jm-track-name">${escHtml(t.name)}</div>
        <div class="jm-track-artist">${escHtml(t.artist)}</div>
      </div>
      <div class="jm-track-dur">${jmFmtTime(t.duration)}</div>
    </div>
  `).join('');
  qEl.querySelectorAll('.jm-track-item').forEach((el, i) => {
    el.addEventListener('click', () => { jamendo.idx = i; jmPlayCurrent(); jmRenderQueue(); });
  });
}

function jmShowLoadError(message) {
  if (jamendo.audio) {
    jamendo.audio.pause();
    jamendo.audio.removeAttribute('src');
    jamendo.audio.load();
  }
  jamendo.isPlaying = false;
  jamendo.queue = [];
  jamendo.idx = 0;
  jmSetPlaylistLabel('Jamendo indisponivel', true);
  jmSetNowPlayingText('Nao foi possivel carregar', message);
  jmSyncUI();
  const qEl = document.getElementById('jmQueueList');
  if (qEl) qEl.innerHTML = `<div class="loading-text jm-error-text">${escHtml(message)}</div>`;
}

async function jmLoadPlaylist(tag, autoplay = true) {
  jamendo.currentTag = tag;
  jmSetPlaylistLabel('Carregando...');
  jqSetActivePlaylist(tag);
  try {
    const res  = await fetch(`/api/jamendo/focus?tags=${encodeURIComponent(tag)}&limit=25`);
    const data = await res.json();
    if (!res.ok || data.error) {
      jmShowLoadError(data.message || 'Erro ao carregar musicas do Jamendo.');
      return [];
    }
    jamendo.queue = data.tracks || [];
    jamendo.idx   = 0;
    if (jamendo.queue.length) {
      if (autoplay) jmPlayCurrent();
      else jmCueCurrent();
      jmSetPlaylistLabel(data.label || tag.charAt(0).toUpperCase() + tag.slice(1));
      jmRenderQueue();
    } else {
      jmSetPlaylistLabel('Sem faixas', true);
      jmSetNowPlayingText('Nenhuma faixa encontrada', 'Tente outra curadoria ou busca.');
      jmRenderQueue();
    }
    return jamendo.queue;
  } catch (e) {
    console.error('Jamendo load', e);
    jmShowLoadError('Falha de rede ao carregar o Jamendo.');
    return [];
  }
}

async function jmSearch(q) {
  const res  = await fetch(`/api/jamendo/search?q=${encodeURIComponent(q)}`);
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.message || 'Erro ao buscar no Jamendo.');
  return data.tracks || [];
}

function jmCueCurrent() {
  const track = jamendo.queue[jamendo.idx];
  if (!track || !track.audio) return;
  jmInit();
  jamendo.audio.src = track.audio;
  jmUpdateNowPlaying(track);
}

function jmPlayCurrent() {
  jmCueCurrent();
  if (!jamendo.audio?.src) return;
  jamendo.audio.play().catch(() => {
    jamendo.isPlaying = false;
    jmSyncUI();
  });
}

function jmPlayTrackFromList(tracks, idx) {
  jamendo.queue = tracks;
  jamendo.idx   = idx;
  jmPlayCurrent();
  jmRenderQueue();
}

async function jmToggle() {
  jmInit();
  if (jamendo.isPlaying) {
    jamendo.audio.pause();
  } else {
    if (!jamendo.queue.length) await jmLoadPlaylist(jamendo.currentTag, false);
    if (!jamendo.audio.src && jamendo.queue.length) jmCueCurrent();
    if (jamendo.audio.src) {
      jamendo.audio.play().catch(() => {
        jamendo.isPlaying = false;
        jmSyncUI();
      });
    }
  }
}

async function jmPlayForFocus() {
  if (!$('jqPlay') && !$('jmPlayBtn')) return;
  jmInit();
  if (!jamendo.queue.length) await jmLoadPlaylist(jamendo.currentTag || 'study', false);
  if (!jamendo.audio.src && jamendo.queue.length) jmCueCurrent();
  if (jamendo.audio.src) {
    jamendo.audio.play().catch(() => {
      jamendo.isPlaying = false;
      jmSyncUI();
    });
  }
}

function jmPause() {
  if (jamendo.audio) jamendo.audio.pause();
}

function jmNext() {
  if (!jamendo.queue.length) return;
  jamendo.idx = (jamendo.idx + 1) % jamendo.queue.length;
  jmPlayCurrent();
  jmRenderQueue();
}

function jmPrev() {
  if (!jamendo.queue.length) return;
  jamendo.idx = (jamendo.idx - 1 + jamendo.queue.length) % jamendo.queue.length;
  jmPlayCurrent();
  jmRenderQueue();
}

function jmSetVolume(v) { jmInit(); jamendo.audio.volume = v; }

function jmUpdateNowPlaying(track) {
  const img = track.image
    ? `<img src="${track.image}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">`
    : iconSvg('headphones');
  document.querySelectorAll('.jm-np-art').forEach(el => el.innerHTML = img);
  document.querySelectorAll('.jm-np-title').forEach(el => el.textContent = track.name);
  document.querySelectorAll('.jm-np-artist').forEach(el => el.textContent = track.artist);
  jqSyncNowPlaying(track);
  jmSyncUI();
}

function jmSyncUI() {
  const pauseIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
  const playIcon  = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>`;
  document.querySelectorAll('.jm-play-btn').forEach(el => el.innerHTML = jamendo.isPlaying ? pauseIcon : playIcon);
}

// Load Jamendo when panel opens; playback starts from a user action.
async function jmAutoStart() {
  if (!jamendo.queue.length) await jmLoadPlaylist('study', false);
}

// ── Jamendo Panel Init ────────────────────────────────────────────────────────
let _jmPanelInited = false;

async function initJamendoPanel() {
  if (_jmPanelInited) return;
  _jmPanelInited = true;

  // Playlist chips
  const container = document.getElementById('jmPlaylists');
  if (container) {
    try {
      const res  = await fetch('/api/jamendo/playlists');
      const data = await res.json();
      container.innerHTML = (data.playlists || []).map(p => `
        <div class="jm-pl-chip" data-tag="${escHtml(p.tag)}">${escHtml(p.name)}</div>
      `).join('');
      container.querySelectorAll('.jm-pl-chip').forEach(el => {
        el.addEventListener('click', () => {
          container.querySelectorAll('.jm-pl-chip').forEach(c => c.classList.remove('jm-pl-chip--active'));
          el.classList.add('jm-pl-chip--active');
          jmLoadPlaylist(el.dataset.tag);
        });
      });
      const first = container.querySelector('.jm-pl-chip');
      if (first) first.classList.add('jm-pl-chip--active');
    } catch {
      container.innerHTML = '<div class="loading-text jm-error-text">Erro ao carregar curadorias.</div>';
    }
  }

  // Player controls
  document.getElementById('jmPlayBtn')?.addEventListener('click', jmToggle);
  document.getElementById('jmPrevBtn')?.addEventListener('click', jmPrev);
  document.getElementById('jmNextBtn')?.addEventListener('click', jmNext);

  const vol = document.getElementById('jmVolSlider');
  if (vol) {
    vol.addEventListener('input', function() {
      jmSetVolume(this.value / 100);
      const disp = document.getElementById('jmVolDisplay');
      if (disp) disp.textContent = this.value + '%';
    });
  }

  // Search
  const doJmSearch = async () => {
    const q = document.getElementById('jmSearchInput')?.value.trim();
    if (!q) return;
    const results = document.getElementById('jmSearchResults');
    if (results) results.innerHTML = '<div class="loading-text">Buscando...</div>';
    let tracks = [];
    try {
      tracks = await jmSearch(q);
    } catch (e) {
      if (results) results.innerHTML = `<div class="loading-text jm-error-text">${escHtml(e.message)}</div>`;
      return;
    }
    if (!results) return;
    if (!tracks.length) { results.innerHTML = '<div class="loading-text">Nenhum resultado.</div>'; return; }
    results.innerHTML = tracks.map((t, i) => `
      <div class="jm-track-item" data-idx="${i}">
        <div class="jm-track-art">${t.image ? `<img src="${t.image}" alt="">` : iconSvg('music')}</div>
        <div class="jm-track-meta">
          <div class="jm-track-name">${escHtml(t.name)}</div>
          <div class="jm-track-artist">${escHtml(t.artist)}</div>
        </div>
        <div class="jm-track-dur">${jmFmtTime(t.duration)}</div>
      </div>
    `).join('');
    results.querySelectorAll('.jm-track-item').forEach((el, i) => {
      el.addEventListener('click', () => jmPlayTrackFromList(tracks, i));
    });
  };
  document.getElementById('jmSearchBtn')?.addEventListener('click', doJmSearch);
  document.getElementById('jmSearchInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') doJmSearch(); });

  // Tab switcher
  document.querySelectorAll('.jm-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.jm-tab').forEach(b => b.classList.remove('jm-tab--active'));
      btn.classList.add('jm-tab--active');
      const tab = btn.dataset.tab;
      document.querySelectorAll('.jm-tab-panel').forEach(p => p.classList.add('hidden'));
      document.getElementById('jm-tab-' + tab)?.classList.remove('hidden');
      if (tab === 'queue') jmRenderQueue();
    });
  });

  jmAutoStart();
}
