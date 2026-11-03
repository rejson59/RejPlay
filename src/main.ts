import './style.css';
import {
  BOTS,
  CHARACTER_MODELS,
  GAMES,
  LOBBY_NAME,
  HAIR_COLORS,
  OUTFITS,
  PALETTE,
  SKIN_TONES,
  type GameInfo,
} from './games';
import { DEFAULT_APPEARANCE, type Appearance } from './character';
import { loadHumanAssets, type HumanAssets } from './human';
import type { HorrorResult, HorrorState } from './horror';
import { World } from './world';
import { HandTracker } from './hand-tracking';
import { OnlineClient, type OnlinePeer, type OnlineStatus } from './online';

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`Nie znaleziono elementu: ${selector}`);
  return element as T;
};

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Prywatny tryb przeglądarki — prototyp działa bez zapisu.
  }
}

function escapeHtml(value: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return value.replace(/[&<>"']/g, (char) => map[char]);
}

function readAppearance(): Appearance {
  try {
    const raw = JSON.parse(readStored('rejplay:appearance') ?? 'null') as Partial<Appearance> | null;
    if (raw) {
      return {
        model:
          typeof raw.model === 'number'
            ? Math.max(0, Math.min(CHARACTER_MODELS.length - 1, Math.floor(raw.model)))
            : DEFAULT_APPEARANCE.model,
        skin: SKIN_TONES.some((entry) => entry.value === raw.skin) ? raw.skin! : DEFAULT_APPEARANCE.skin,
        hair: HAIR_COLORS.some((entry) => entry.value === raw.hair) ? raw.hair! : DEFAULT_APPEARANCE.hair,
        outfit: OUTFITS.some((entry) => entry.value === raw.outfit)
          ? raw.outfit!
          : DEFAULT_APPEARANCE.outfit,
      };
    }
  } catch {
    // Uszkodzony zapis — wracamy do domyślnego wyglądu.
  }
  return { ...DEFAULT_APPEARANCE };
}

const state = {
  nick: readStored('rejplay:nick') || `Gracz_${Math.floor(10 + Math.random() * 90)}`,
  color: readStored('rejplay:color') || PALETTE[0].value,
  theme: (readStored('rejplay:theme') === 'dark' ? 'dark' : 'light') as 'dark' | 'light',
  appearance: readAppearance(),
};
if (!PALETTE.some((entry) => entry.value === state.color)) state.color = PALETTE[0].value;

let gameReturn: 'home' | 'lobby' = 'home';
let roundActive = false;

// ------------------------------------------------- multiplayer (Supabase)
let onlinePeers: OnlinePeer[] = [];
let onlineStatus: OnlineStatus = 'connecting';
const online = new OnlineClient({
  nick: state.nick,
  color: state.color,
  appearance: state.appearance,
  mode: 'home',
  x: 0, y: 0, z: 0, yaw: 0,
});

// ------------------------------------------------------------------ referencje

const home = $('#home');
const lobby = $('#lobby');
const game = $('#game');
const editor = $('#editor');
const heroStage = $('#hero-stage');
const editorStage = $('#editor-stage');
const lobbyStage = $('#lobby-stage');
const gameStage = $('#game-stage');
const nickInput = $<HTMLInputElement>('#nick');
const swatches = $('#swatches');
const gameGrid = $('#game-grid');
const playerList = $('#player-list');
const playerCount = $('#player-count');
const onlineCount = $('#online-count');
const chatLog = $('#chat-log');
const chatForm = $<HTMLFormElement>('#chat-form');
const chatInput = $<HTMLInputElement>('#chat-input');
const globalToast = $('#global-toast');
const lobbyToast = $('#lobby-toast');
const gameToast = $('#game-toast');
const touchControls = $('#touch-controls');
const joystick = $('#joystick');
const joystickKnob = $('#joystick-knob');
const jumpButton = $<HTMLButtonElement>('#jump-btn');
const bootOverlay = $('#boot-overlay');
const modelList = $('#model-list');
const skinList = $('#skin-list');
const hairList = $('#hair-list');
const outfitList = $('#outfit-list');
const gameIntro = $('#game-intro');
const gameHud = $('#game-hud');
const gameTools = $('#game-tools');
const gameJournal = $('#game-journal');
const gameResult = $('#game-result');
const gameTouch = $('#game-touch');
const qualityToggle = $('#quality-toggle');
const qualityLabel = $('#quality-label');
const gameTimer = $('#game-timer');
const hudNerves = $('#hud-nerves');
const hudNervesBar = $('#hud-nerves-bar');
const hudEvidence = $('#hud-evidence');
const hudToolName = $('#hud-tool-name');
const hudReading = $('#hud-reading');
const hudReadingBar = $('#hud-reading-bar');
const hudScanBar = $('#hud-scan-bar');
const hudHint = $('#hud-hint');
const tutorial = $('#tutorial');
const tutorialStepsBox = $('#tutorial-steps');
const tutorialDots = $('#tutorial-dots');
const tutorialTitle = $('#tutorial-title');
const tutorialText = $('#tutorial-text');
const tutorialGlyph = $('#tutorial-glyph');
const tutorialCaption = $('#tutorial-caption');
const tutorialProgress = $('#tutorial-progress');
const tutorialPrev = $<HTMLButtonElement>('#tutorial-prev');
const tutorialNext = $<HTMLButtonElement>('#tutorial-next');
const handPanel = $('#hand-panel');
const handVideo = $<HTMLVideoElement>('#hand-video');
const handCanvas = $<HTMLCanvasElement>('#hand-canvas');
const handReadout = $('#hand-readout');
const handStatus = $('#hand-status');
const handToggles = document.querySelectorAll<HTMLElement>('[data-hand-toggle]');
const livePill = $('#live-pill');
const liveStatus = $('#live-status');
const liveCount = $('#live-count');
const liveList = $('#live-list');
const liveSub = $('#live-sub');

let world!: World;

// --------------------------------------------------------------------- toasty

const toastTimers = new WeakMap<HTMLElement, number>();

function showToast(element: HTMLElement, message: string): void {
  element.textContent = message;
  element.classList.add('is-visible');
  window.clearTimeout(toastTimers.get(element));
  toastTimers.set(
    element,
    window.setTimeout(() => element.classList.remove('is-visible'), 3600),
  );
}

// -------------------------------------------------------------- home / katalog

/** Katalog = jedna gra + wspólne lobby (hub nie jest osobną grą). */
const CATALOG: Array<{ id: string; title: string; tag: string; art: string; ready: boolean }> = [
  ...GAMES.map((game) => ({
    id: game.id,
    title: game.title,
    tag: game.tag,
    art: game.art,
    ready: game.ready,
  })),
  { id: 'plaza', title: LOBBY_NAME, tag: '3D · Lobby', art: '', ready: true },
];

let searchQuery = '';

function renderGames(): void {
  const query = searchQuery.trim().toLowerCase();
  const visible = GAMES.filter((game) =>
    !query || `${game.title} ${game.tag} ${game.description} ${game.claim} lobby atrium`.toLowerCase().includes(query),
  );

  gameGrid.innerHTML = visible
    .map((game) => {
      const stats = `<span class="game-card__stat">${escapeHtml(game.players)}</span>
           <span class="game-card__stat">Do uruchomienia od razu</span>`;
      return `
        <article class="game-card game-card--ready" style="--card-art:url('${game.art}');">
          <div class="game-card__art" aria-hidden="true">
            <span class="game-card__badge">Działa</span>
          </div>
          <div class="game-card__body">
            <span class="game-card__tag">${escapeHtml(game.tag)}</span>
            <h3>${escapeHtml(game.title)}</h3>
            <p>${escapeHtml(game.description)}</p>
            <div class="game-card__stats">${stats}</div>
            <div class="game-card__foot">
              <span class="game-card__players">◉ ${escapeHtml(game.players)}</span>
              <button type="button" class="btn btn--sm btn--primary" data-game="${game.id}">Graj</button>
            </div>
          </div>
        </article>`;
    })
    .join('');

  $('#shelf-empty').hidden = visible.length > 0;
  $('#shelf-count').textContent = `${visible.length} ${visible.length === 1 ? 'świat' : 'światy'}`;
}

function renderFeatured(): void {
  const game = GAMES[0];
  $('#featured-title').textContent = game.title;
  $('#featured-tag').textContent = game.tag;
  $('#featured-desc').textContent = game.claim;
  $('#featured-meta').textContent = `${game.tag} · ${game.players} · bez logowania`;
  $('#featured-art').style.setProperty('--feat-art', `url('${game.art}')`);
}

function renderFriends(): void {
  $('#friends-row').innerHTML = BOTS.slice(0, 3)
    .map(
      (bot) => `
        <div class="friend">
          <span class="friend__avatar" style="--fc:${bot.color}">${escapeHtml(bot.name.slice(0, 1))}</span>
          <span>${escapeHtml(bot.name)}</span>
          <span class="friend__status" title="Bot demonstracyjny"></span>
        </div>`,
    )
    .join('');
}

function readRecent(): string[] {
  try {
    const raw = JSON.parse(readStored('rejplay:recent') ?? '[]') as unknown;
    if (Array.isArray(raw)) return raw.filter((id): id is string => typeof id === 'string').slice(0, 3);
  } catch {
    // Uszkodzony zapis — traktujemy jako pusty.
  }
  return [];
}

function recordVisit(id: string): void {
  const next = [id, ...readRecent().filter((entry) => entry !== id)].slice(0, 3);
  store('rejplay:recent', JSON.stringify(next));
  renderRecent();
}

function renderRecent(): void {
  const recent = readRecent()
    .map((id) => CATALOG.find((entry) => entry.id === id))
    .filter((entry): entry is (typeof CATALOG)[number] => Boolean(entry));
  const row = $('#recent-row');
  if (recent.length === 0) {
    row.innerHTML = `<div class="recent-card--empty">Jeszcze nic nie odwiedziłeś. Uruchom dochodzenie lub wejdź do ${escapeHtml(LOBBY_NAME)} — pojawi się tutaj, żebyś mógł szybko wrócić.</div>`;
    return;
  }
  row.innerHTML = recent
    .map((entry) => {
      const art = entry.art ? `--card-art:url('${entry.art}');` : '';
      return `
        <div class="recent-card" style="${art}">
          <span class="recent-card__art" aria-hidden="true"></span>
          <div class="recent-card__body">
            <h3>${escapeHtml(entry.title)}</h3>
            <span>${escapeHtml(entry.tag)}</span>
          </div>
          <button type="button" class="btn btn--sm btn--primary" data-game="${entry.id}">Wróć</button>
        </div>`;
    })
    .join('');
}

/** Jedno miejsce decyduje, co robi kliknięcie kafelka z dowolnej półki. */
function launchGame(id: string): void {
  if (id === 'demonofobia') {
    openGame('home');
  } else if (id === 'plaza') {
    enterLobby();
  }
}

// ------------------------------------------------------------------- motyw

function applyTheme(theme: 'light' | 'dark'): void {
  state.theme = theme;
  store('rejplay:theme', theme);
  document.body.dataset.theme = theme;
  document.documentElement.dataset.theme = theme;
  const dark = theme === 'dark';
  const button = $('#theme-toggle');
  const label = button.querySelector<HTMLElement>('.theme-toggle__label');
  const icon = button.querySelector<HTMLElement>('.theme-toggle__ico');
  if (label) label.textContent = dark ? 'Tryb jasny' : 'Tryb ciemny';
  if (icon) icon.textContent = dark ? '☀' : '☾';
  button.setAttribute('aria-pressed', String(dark));
  button.title = dark ? 'Wróć do trybu jasnego' : 'Przełącz tryb ciemny';
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = dark ? '#12171a' : '#f1f0ec';
}

// ----------------------------------------------------- śledzenie dłoni / kamerka

const handTracker = new HandTracker({
  video: handVideo,
  canvas: handCanvas,
  onFrame: (hands, aspect) => {
    // Surowy odczyt 21 punktów na dłoń → kąty 15 stawów → kości awatara
    // i dłonie first-person w grze. Zero klasyfikacji gestów, zero animacji
    // wyzwalanych „rozpoznanym układem palców”.
    world.setHandPose(hands, aspect);
    handReadout.textContent =
      hands.length === 0
        ? 'Pokaż dłonie w kadrze'
        : hands.length === 1
          ? '1 dłoń · 15 stawów 1:1'
          : '2 dłonie · 30 stawów 1:1';
  },
  onStatus: (message, kind) => {
    handStatus.textContent = message;
    handStatus.classList.toggle('is-error', kind === 'error');
  },
});

function syncHandButtons(): void {
  const on = handTracker.active;
  handToggles.forEach((button) => button.classList.toggle('is-on', on));
}

async function openHands(): Promise<void> {
  handPanel.classList.add('is-active');
  handPanel.setAttribute('aria-hidden', 'false');
  handReadout.textContent = 'Uruchamianie kamerki…';
  handStatus.classList.remove('is-error');
  try {
    await handTracker.start();
    handPanel.classList.add('is-on');
    syncHandOverlay();
  } catch (error) {
    handPanel.classList.remove('is-on');
    handReadout.textContent = 'Kamerka niedostępna';
    handStatus.textContent = error instanceof Error ? error.message : String(error);
    handStatus.classList.add('is-error');
  }
  syncHandButtons();
}

function closeHands(): void {
  handTracker.stop();
  handPanel.classList.remove('is-active', 'is-on');
  handPanel.setAttribute('aria-hidden', 'true');
  handReadout.textContent = 'Kamerka wyłączona';
  handStatus.textContent = 'Obraz nie opuszcza przeglądarki.';
  handStatus.classList.remove('is-error');
  syncHandButtons();
}

/** W grze panel kamerki jest schowany — nie rysujemy nieużywanego szkieletu 2D. */
function syncHandOverlay(): void {
  handTracker.setOverlayVisible(!game.classList.contains('is-active'));
}

function renderSwatches(): void {
  swatches.innerHTML = PALETTE.map(
    (entry) => `
      <button
        type="button"
        class="swatch"
        data-color="${entry.value}"
        style="--swatch:${entry.value}"
        aria-label="Kolor: ${escapeHtml(entry.name)}"
        title="${escapeHtml(entry.name)}"
      ></button>`,
  ).join('');
  updateSwatches();
}

function updateSwatches(): void {
  swatches.querySelectorAll<HTMLButtonElement>('.swatch').forEach((button) => {
    const active = button.dataset.color === state.color;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function applyColor(color: string): void {
  state.color = color;
  store('rejplay:color', color);
  world.setPlayerColor(color);
  online.update({ color });
  updateSwatches();
  renderPlayerList();
}

function applyNick(raw: string): void {
  state.nick = raw.trim().slice(0, 16) || 'Gość';
  store('rejplay:nick', state.nick);
  world.setPlayerName(state.nick);
  renderPlayerList();
  $('#chip-nick').textContent = state.nick;
  $('#chip-avatar').textContent = state.nick.slice(0, 1).toUpperCase();
  $('#tile-nick').textContent = state.nick;
  online.update({ nick: state.nick });
}

// ------------------------------------------------------------------- edytor

function renderEditor(): void {
  const a = state.appearance;
  modelList.innerHTML = CHARACTER_MODELS.map(
    (entry, i) => `
      <button type="button" class="option ${a.model === i ? 'is-active' : ''}" data-field="model" data-index="${i}">
        ${String(i + 1).padStart(2, '0')} · ${escapeHtml(entry.name)}<small>${escapeHtml(entry.look)}</small>
      </button>`,
  ).join('');

  const colorRow = (entries: Array<{ name: string; value: string }>, field: string, current: string): string =>
    entries
      .map(
        (entry) => `
        <button
          type="button"
          class="option ${current === entry.value ? 'is-active' : ''}"
          data-field="${field}"
          data-value="${entry.value}"
          title="${escapeHtml(entry.name)}"
          aria-label="${escapeHtml(entry.name)}"
        >
          <span class="option__swatch" style="--opt:${entry.value}"></span>
          ${escapeHtml(entry.name)}
        </button>`,
      )
      .join('');

  const outfitRow = (current: string): string =>
    OUTFITS.map(
      (entry) => `
        <button
          type="button"
          class="option option--outfit ${current === entry.value ? 'is-active' : ''}"
          data-field="outfit"
          data-value="${entry.value}"
          title="${escapeHtml(entry.description)}"
          aria-label="${escapeHtml(entry.name)} — ${escapeHtml(entry.description)}"
        >
          <span class="option__swatch" style="--opt:${entry.color}"></span>
          <span class="option__outfit"><b>${escapeHtml(entry.name)}</b><small>${escapeHtml(entry.description)}</small></span>
        </button>`,
    ).join('');

  skinList.innerHTML = colorRow(SKIN_TONES, 'skin', a.skin);
  hairList.innerHTML = colorRow(HAIR_COLORS, 'hair', a.hair);
  outfitList.innerHTML = outfitRow(a.outfit);
}

function applyAppearance(patch: Partial<Appearance>): void {
  state.appearance = { ...state.appearance, ...patch };
  store('rejplay:appearance', JSON.stringify(state.appearance));
  world.setPlayerAppearance(state.appearance);
  online.update({ appearance: state.appearance });
  renderEditor();
}

function openEditor(): void {
  if (editor.classList.contains('is-active')) return;
  if (lobby.classList.contains('is-active') || game.classList.contains('is-active')) return;
  editor.classList.add('is-active');
  editor.setAttribute('aria-hidden', 'false');
  renderEditor();
  world.setPreviewClose(true);
  world.mount(editorStage, 'home');
}

function closeEditor(): void {
  if (!editor.classList.contains('is-active')) return;
  editor.classList.remove('is-active');
  editor.setAttribute('aria-hidden', 'true');
  world.setPreviewClose(false);
  world.mount(heroStage, 'home');
}

// ------------------------------------------------------------------- lobby UI

function renderPlayerList(): void {
  const real = onlinePeers.filter((peer) => peer.mode === 'lobby');
  const entries = [
    { name: state.nick, color: state.color, you: true, live: onlineStatus === 'online' },
    ...real.map((peer) => ({ name: peer.nick, color: peer.color, you: false, live: true })),
    ...BOTS.map((bot) => ({ name: bot.name, color: bot.color, you: false, live: false })),
  ];
  playerList.innerHTML = entries
    .map(
      (entry) => `
        <li>
          <span class="player__dot" style="--dot:${entry.color}"></span>
          <span class="player__name">${escapeHtml(entry.name)}</span>
          ${entry.you ? '<span class="player__you">Ty</span>' : ''}
          ${entry.live ? '<span class="player__live" title="Gracz online">●</span>' : ''}
        </li>`,
    )
    .join('');
  playerCount.textContent = String(entries.length);
  onlineCount.textContent = `${real.length + 1} ${real.length ? 'graczy' : 'gracz'} online · ${BOTS.length} boty demo`;
  renderLive();
}

/** Panel „Na żywo” na stronie głównej — wyłącznie prawdziwe dane z presence. */
function renderLive(): void {
  const real = onlinePeers.filter((peer) => peer.mode !== 'game');
  livePill.classList.toggle('is-online', onlineStatus === 'online');
  livePill.classList.toggle('is-offline', onlineStatus === 'offline');
  liveStatus.textContent =
    onlineStatus === 'online' ? `${real.length + 1} online` :
    onlineStatus === 'offline' ? 'Tryb offline' : 'Łączę…';
  liveSub.textContent =
    onlineStatus === 'online' ? 'Supabase Realtime · Atrium' :
    onlineStatus === 'offline' ? 'Gra działa lokalnie · czat w tej karcie' : 'Supabase Realtime · łączenie…';
  liveCount.textContent = String(real.length + 1);
  const rows = [
    `<li><i style="background:${escapeHtml(state.color)}"></i>${escapeHtml(state.nick)} (Ty)</li>`,
    ...real.map(
      (peer) => `<li><i style="background:${escapeHtml(peer.color)}"></i>${escapeHtml(peer.nick)} · ${peer.mode === 'lobby' ? 'Atrium' : 'Start'}</li>`,
    ),
  ];
  if (real.length === 0) {
    rows.push('<li class="is-empty">Nikogo jeszcze nie ma — wejdź pierwszy</li>');
  }
  liveList.innerHTML = rows.join('');
}

function addChatMessage(name: string, text: string, color?: string): void {
  const row = document.createElement('div');
  row.className = 'chat__msg';
  const author = document.createElement('b');
  author.textContent = name;
  if (color) author.style.color = color;
  const body = document.createElement('span');
  body.textContent = text;
  row.append(author, document.createTextNode(' '), body);
  chatLog.appendChild(row);
  chatLog.scrollTop = chatLog.scrollHeight;
}

let chatSeeded = false;
function seedChat(): void {
  if (chatSeeded) return;
  chatSeeded = true;
  addChatMessage(
    'RejPlay',
    onlineStatus === 'online'
      ? 'Czat jest współdzielony przez Supabase — widzą go wszyscy w Atrium.'
      : 'Brak połączenia z bazą — wiadomości zostają w tej karcie.',
  );
}

function triggerWave(): void {
  if (game.classList.contains('is-active')) return;
  world.wave();
  showToast(
    lobby.classList.contains('is-active') ? lobbyToast : globalToast,
    `${state.nick} macha do wszystkich`,
  );
}

/** Foto-dowód z wnętrza domu — ta sama klatka, inny kontekst. */
function captureGamePhoto(): void {
  const dataUrl = world.capturePhoto();
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = `demonofobia-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
  link.click();
  online.event('photo');
  showToast(gameToast, 'Foto-dowód zapisany jako PNG');
}

function enterLobby(): void {
  if (lobby.classList.contains('is-active')) return;
  closeEditor();
  lobby.classList.add('is-active');
  lobby.setAttribute('aria-hidden', 'false');
  home.setAttribute('aria-hidden', 'true');
  document.body.classList.add('in-lobby');
  document.body.classList.remove('in-game');
  document.title = `${LOBBY_NAME} · RejPlay`;
  world.setPreviewClose(false);
  world.mount(lobbyStage, 'lobby');
  online.update({ mode: 'lobby' });
  renderPlayerList();
  seedChat();
  recordVisit('plaza');
  online.event('lobby_enter');
  showToast(lobbyToast, `${LOBBY_NAME} · WASD = ruch, E = machnięcie, kamerka = ruchy palców 1:1`);
}

function goHome(): void {
  if (!lobby.classList.contains('is-active')) return;
  lobby.classList.remove('is-active');
  lobby.setAttribute('aria-hidden', 'true');
  home.setAttribute('aria-hidden', 'false');
  document.body.classList.remove('in-lobby');
  document.title = 'RejPlay — Demonofobia i Atrium 3D';
  chatInput.blur();
  online.update({ mode: 'home' });
  world.mount(heroStage, 'home');
  renderRecent();
}

// -------------------------------------------------------------- HUD Demonofobia

let lastEvidenceSignature = '';
let lastJournalSignature = '';
let lastResultSignature = '';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function renderHorrorState(state: HorrorState): void {
  if (!game.classList.contains('is-active') || !roundActive) return;

  game.classList.toggle('is-hunting', state.hunting);
  gameTimer.textContent = formatTime(state.seconds);
  hudNerves.textContent = String(state.nerves);
  hudNervesBar.style.width = `${state.nerves}%`;
  hudNervesBar.style.background = state.nerves < 32 ? 'var(--danger)' : 'var(--accent)';

  const tool = state.tools[state.toolIndex];
  hudToolName.textContent = tool.name;
  hudReading.textContent = `${Math.round(state.reading * 100)}%`;
  hudReadingBar.style.width = `${Math.round(state.reading * 100)}%`;
  hudScanBar.style.width = `${Math.round(state.scan * 100)}%`;
  hudHint.textContent = `${state.hunting ? 'NALOT · ' : ''}${state.hint}`;
  const photoCount = $('#game-photo-count');
  if (photoCount) photoCount.textContent = String(state.photos);

  const evidenceSignature = state.evidence.map((entry) => `${entry.id}:${entry.status}`).join('|');
  if (evidenceSignature !== lastEvidenceSignature) {
    lastEvidenceSignature = evidenceSignature;
    hudEvidence.innerHTML = `
      <h4>Notatnik · ślady</h4>
      ${state.evidence
        .map((entry) => {
          const mark = entry.status === 'found' ? '✓' : entry.status === 'absent' ? '✕' : '○';
          return `<div class="evi evi--${entry.status}"><span class="evi__mark">${mark}</span>${escapeHtml(entry.name)}</div>`;
        })
        .join('')}`;
  }

  gameTools.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => {
    button.classList.toggle('is-active', Number(button.dataset.tool) === state.toolIndex);
  });
  const lightButton = gameTools.querySelector<HTMLButtonElement>('[data-game-action="light"]');
  if (lightButton) lightButton.classList.toggle('is-active', state.flashlight);

  gameJournal.hidden = !state.journal;
  const journalSignature = `${state.journal}|${evidenceSignature}|${state.canReport}`;
  if (state.journal && journalSignature !== lastJournalSignature) {
    lastJournalSignature = journalSignature;
    gameJournal.innerHTML = `
      <div class="journal__card">
        <span class="section__kicker">Notatnik dochodzenia</span>
        <h2>Która zjawa tu zostaje?</h2>
        <p>${state.canReport
          ? 'Masz komplet odczytów. Porównaj ślady z opisami i złóż raport.'
          : 'Nie wszystkie narzędzia zostały użyte. Pomyłka kosztuje nerwy, ale możesz zgadywać już teraz.'}</p>
        <div class="journal__evidence">
          ${state.evidence
            .map(
              (entry) =>
                `<span class="${entry.status === 'found' ? 'is-found' : entry.status === 'absent' ? 'is-absent' : ''}">${escapeHtml(entry.name)} · ${
                  entry.status === 'found' ? 'wykryto' : entry.status === 'absent' ? 'brak' : 'nie zbadano'
                }</span>`,
            )
            .join('')}
        </div>
        <div class="ghost-grid">
          ${state.ghosts
            .map(
              (ghost) => `
              <button type="button" class="ghost-card" data-ghost="${ghost.id}">
                <strong>${escapeHtml(ghost.name)}</strong>
                <span>${escapeHtml(ghost.hint)}</span>
              </button>`,
            )
            .join('')}
        </div>
        <div class="journal__actions">
          <button type="button" class="btn btn--ghost" data-game-action="close-journal">Wróć do domu <kbd>J</kbd></button>
        </div>
      </div>`;
  }

  gameResult.hidden = !state.result;
  const resultSignature = state.result ? `${state.result.win}|${state.result.reason}|${state.result.seconds}` : '';
  if (state.result && resultSignature !== lastResultSignature) {
    lastResultSignature = resultSignature;
    const result = state.result;
    gameResult.innerHTML = `
      <div class="result__card">
        <span class="result__verdict ${result.win ? '' : 'is-lost'}">${result.win ? 'Raport przyjęty' : 'Dochodzenie przerwane'}</span>
        <h2>${result.win ? `To była ${escapeHtml(result.ghost)}.` : escapeHtml(result.ghost)}</h2>
        <p>${escapeHtml(result.reason)}</p>
        <div class="result__list">
          Czas w domu: ${formatTime(result.seconds)}<br />
          Zapisane ślady: ${result.found.length ? result.found.map(escapeHtml).join(', ') : 'brak'}<br />
          Narzędzia: termometr, miernik pola, rejestrator
        </div>
        <div class="intro__actions">
          <button type="button" class="btn btn--primary" data-game-action="retry">Jeszcze raz</button>
          <button type="button" class="btn btn--ghost" data-game-action="exit">Wróć ${gameReturn === 'lobby' ? 'do lobby' : 'na stronę główną'}</button>
        </div>
      </div>`;
  }
}

function renderGameTools(): void {
  const tools = [
    { name: 'Termometr', key: '1' },
    { name: 'Miernik pola', key: '2' },
    { name: 'Rejestrator', key: '3' },
  ];
  gameTools.innerHTML =
    tools
      .map(
        (tool, i) => `
        <button type="button" class="tool-btn" data-tool="${i}">
          <kbd>${tool.key}</kbd><b>${escapeHtml(tool.name)}</b>odczyt śladu
        </button>`,
      )
      .join('') +
    `<button type="button" class="tool-btn" data-game-action="light"><kbd>F</kbd><b>Latarka</b>włącz / wyłącz</button>
     <button type="button" class="tool-btn" data-game-action="photo"><kbd>P</kbd><b>Foto-dowód</b>zapisz klatkę · <span id="game-photo-count">0</span></button>
     <button type="button" class="tool-btn" data-game-action="journal"><kbd>J</kbd><b>Notatnik</b>złóż raport</button>`;
}

function showHorrorResult(result: HorrorResult): void {
  online.event(result.win ? 'game_win' : 'game_fail', result.ghost);
  roundActive = false;
  showToast(gameToast, result.win ? 'Raport przyjęty. Udało się rozpoznać zjawę.' : result.reason);
}

// ---------------------------------------------------------------- samouczek

interface TutorialStep {
  title: string;
  text: string;
  glyph: string;
  caption: string;
  tag: string;
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    tag: 'Ruch',
    title: 'Wejdź do domu i rozejrzyj się',
    text: 'Klawisze W A S D prowadzą postać, a myszką rozglądasz się bez blokady kursora. Shift to krótki sprint. Na telefonie użyj joysticka po lewej i przeciągnij palcem po prawej stronie ekranu.',
    glyph: 'W A S D',
    caption: 'kursor zostaje wolny',
  },
  {
    tag: 'Narzędzia',
    title: 'Zabierz trzy przyrządy',
    text: 'Termometr (1) szuka zimnego punktu, miernik pola (2) zakłóceń prądu, a rejestrator (3) szeptów. Każdy ślad ma własne miejsce w domu — zmieniaj narzędzia w trakcie obchodu.',
    glyph: '1  2  3',
    caption: 'trzy narzędzia, trzy ślady',
  },
  {
    tag: 'Skan',
    title: 'Przytrzymaj E przy śladzie',
    text: 'Podejdź do punktu z aktywnym narzędziem i przytrzymaj E około sekundy. Pasek skanu się zapełni, a w notatniku pojawi się „wykryto" albo „brak". Zbadaj wszystkie trzy rodzaje śladów, zanim zgadujesz.',
    glyph: 'E',
    caption: 'przytrzymaj ~1 s',
  },
  {
    tag: 'Foto-dowód',
    title: 'Zrób zdjęcie klawiszem P',
    text: 'Foto-dowód zapisuje aktualną klatkę jako plik PNG. Zdjęcie zrobione przy silnym odczycie trochę uspokaja nerwy, a podczas nalotu potrafi go przerwać, jeśli uchwycisz sylwetkę.',
    glyph: 'P',
    caption: 'zapis do pliku PNG',
  },
  {
    tag: 'Nalot',
    title: 'Uważaj na nalot',
    text: 'Co jakiś czas zjawa rusza w Twoją stronę: światło migocze, nerwy spadają szybciej, a w korytarzu widać sylwetkę. Wyjdź frontowymi drzwiami, zrób jej zdjęcie albo przeczekaj kilkanaście sekund.',
    glyph: '!',
    caption: 'latarka F · ucieczka lub P',
  },
  {
    tag: 'Notatnik',
    title: 'Porównaj ślady z opisami',
    text: 'Klawisz J albo Tab otwiera notatnik. Sześć autorskich zjaw ma różne zestawy śladów: jedna zostawia tylko zimno, inna wszystkie trzy. Odczytaj tabelę i wybierz pasującą.',
    glyph: 'J',
    caption: 'sześć typów zjaw',
  },
  {
    tag: 'Raport',
    title: 'Złóż raport i wyjdź',
    text: 'Kliknij wybraną zjawę w notatniku. Trafny raport kończy rundę sukcesem, pomyłka kosztuje nerwy. Wyjście z gry jest zawsze pod ręką w prawym górnym rogu — Esc działa tak samo.',
    glyph: '✓',
    caption: 'Esc = wyjście',
  },
];

let tutorialStep = 0;

function renderTutorial(): void {
  tutorialStepsBox.innerHTML = TUTORIAL_STEPS.map(
    (step, i) => `<button type="button" class="tutorial__step" data-tutorial-step="${i}"><span>${String(i + 1).padStart(2, '0')}</span>${escapeHtml(step.tag)}</button>`,
  ).join('');
  tutorialDots.innerHTML = TUTORIAL_STEPS.map(
    (_, i) => `<button type="button" class="tutorial__dot" data-tutorial-step="${i}" aria-label="Krok ${i + 1}"></button>`,
  ).join('');
  if (readStored('rejplay:tutorial')) {
    const button = $<HTMLButtonElement>('#tutorial-open');
    button.textContent = 'Powtórz samouczek';
  }
  setTutorialStep(0);
}

function setTutorialStep(index: number): void {
  tutorialStep = Math.max(0, Math.min(TUTORIAL_STEPS.length - 1, index));
  const step = TUTORIAL_STEPS[tutorialStep];
  tutorialTitle.textContent = step.title;
  tutorialText.textContent = step.text;
  tutorialGlyph.textContent = step.glyph;
  tutorialCaption.textContent = step.caption;
  tutorialProgress.textContent = `${String(tutorialStep + 1).padStart(2, '0')} / ${String(TUTORIAL_STEPS.length).padStart(2, '0')}`;
  tutorialPrev.disabled = tutorialStep === 0;
  tutorialNext.textContent = tutorialStep === TUTORIAL_STEPS.length - 1 ? 'Rozumiem, gram' : 'Dalej';
  for (const element of tutorial.querySelectorAll<HTMLElement>('[data-tutorial-step]')) {
    element.classList.toggle('is-active', Number(element.dataset.tutorialStep) === tutorialStep);
    element.setAttribute('aria-current', Number(element.dataset.tutorialStep) === tutorialStep ? 'step' : 'false');
  }
}

function openTutorial(): void {
  setTutorialStep(0);
  tutorial.classList.add('is-active');
  tutorial.setAttribute('aria-hidden', 'false');
  tutorialNext.focus();
}

function closeTutorial(): void {
  tutorial.classList.remove('is-active');
  tutorial.setAttribute('aria-hidden', 'true');
  store('rejplay:tutorial', '1');
  const button = $<HTMLButtonElement>('#tutorial-open');
  button.textContent = 'Powtórz samouczek';
}

// -------------------------------------------------------------- wejście do gry

function openGame(from: 'home' | 'lobby'): void {
  closeEditor();
  // Kamerka zostaje włączona: panel chowa się (CSS), a odczyt palców nadal
  // steruje dłońmi first-person. Wyłączenie trackingu zabiłoby 1:1 w grze.
  if (handTracker.active) {
    handPanel.setAttribute('aria-hidden', 'true');
    syncHandOverlay();
    showToast(gameToast, 'Kamerka działa — palce sterują dłońmi w grze 1:1.');
  }
  gameReturn = from;
  roundActive = false;
  lobby.classList.remove('is-active');
  lobby.setAttribute('aria-hidden', 'true');
  game.classList.add('is-active');
  game.setAttribute('aria-hidden', 'false');
  home.setAttribute('aria-hidden', 'true');
  document.body.classList.add('in-game');
  document.body.classList.remove('in-lobby');
  document.title = 'Demonofobia · RejPlay';
  recordVisit('demonofobia');
  online.update({ mode: 'game' });
  online.event('game_open');
  gameIntro.hidden = false;
  gameHud.hidden = true;
  gameTools.hidden = true;
  gameJournal.hidden = true;
  gameResult.hidden = true;
  lastEvidenceSignature = '';
  lastJournalSignature = '';
  lastResultSignature = '';
}

function startGameRound(): void {
  gameIntro.hidden = true;
  gameResult.hidden = true;
  gameJournal.hidden = true;
  gameHud.hidden = false;
  gameTools.hidden = false;
  roundActive = true;
  lastEvidenceSignature = '';
  lastJournalSignature = '';
  lastResultSignature = '';
  world.setPreviewClose(false);
  world.mount(gameStage, 'game'); // setActive(true) → HorrorGame.start()
  world.horror.beginInput();
  syncHandOverlay();
  online.event('game_start');
  showToast(gameToast, 'Przytrzymaj E, aby skanować. 1 / 2 / 3 zmieniają narzędzia.');
}

function exitGame(): void {
  roundActive = false;
  game.classList.remove('is-active');
  game.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('in-game');
  gameJournal.hidden = true;
  gameResult.hidden = true;
  gameIntro.hidden = true;
  handPanel.setAttribute('aria-hidden', handTracker.active ? 'false' : 'true');
  syncHandOverlay();
  online.update({ mode: gameReturn === 'lobby' ? 'lobby' : 'home' });
  if (gameReturn === 'lobby') {
    lobby.classList.add('is-active');
    lobby.setAttribute('aria-hidden', 'false');
    document.body.classList.add('in-lobby');
    document.title = `${LOBBY_NAME} · RejPlay`;
    world.mount(lobbyStage, 'lobby');
    renderPlayerList();
  } else {
    home.setAttribute('aria-hidden', 'false');
    document.title = 'RejPlay — Demonofobia i Atrium 3D';
    world.mount(heroStage, 'home');
    renderRecent();
  }
}

// ------------------------------------------------------------------- listeners

document.addEventListener('click', (event) => {
  const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!action) return;
  switch (action.dataset.action) {
    case 'enter-lobby':
      enterLobby();
      break;
    case 'open-editor':
      openEditor();
      break;
    case 'close-editor':
      closeEditor();
      break;
    case 'open-info':
      $('#how').scrollIntoView({ behavior: 'smooth', block: 'start' });
      break;
  }
});

// Kategorie, wyszukiwarka i karuzela wyróżnionych światów
$<HTMLInputElement>('#game-search').addEventListener('input', (event) => {
  searchQuery = (event.target as HTMLInputElement).value;
  renderGames();
});

window.addEventListener('keydown', (event) => {
  if (event.key !== '/' || editor.classList.contains('is-active')) return;
  const tag = (event.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (game.classList.contains('is-active') || lobby.classList.contains('is-active')) return;
  event.preventDefault();
  $<HTMLInputElement>('#game-search').focus();
});

$('#featured-play').addEventListener('click', () => launchGame(GAMES[0].id));
$('#theme-toggle').addEventListener('click', () => applyTheme(state.theme === 'dark' ? 'light' : 'dark'));

let worldReady = false;
function syncQualityLabel(): void {
  if (worldReady) qualityLabel.textContent = world.qualityControl.buttonLabel;
}
qualityToggle.addEventListener('click', () => {
  if (!worldReady) return;
  world.qualityControl.cycle();
  syncQualityLabel();
  showToast(globalToast, `${world.qualityControl.buttonLabel} — działa od razu, także w grze.`);
});

handToggles.forEach((button) => {
  button.addEventListener('click', () => {
    if (handTracker.active) closeHands();
    else void openHands();
  });
});
$('#hand-close').addEventListener('click', closeHands);

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  if (target.closest('[data-tutorial-open]')) {
    openTutorial();
    return;
  }
  if (target.closest('[data-tutorial-close]')) {
    closeTutorial();
    return;
  }
  const stepButton = target.closest<HTMLElement>('[data-tutorial-step]');
  if (stepButton?.dataset.tutorialStep !== undefined) {
    setTutorialStep(Number(stepButton.dataset.tutorialStep));
  }
});
tutorialPrev.addEventListener('click', () => setTutorialStep(tutorialStep - 1));
tutorialNext.addEventListener('click', () => {
  if (tutorialStep === TUTORIAL_STEPS.length - 1) closeTutorial();
  else setTutorialStep(tutorialStep + 1);
});

gameGrid.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-game]');
  if (button?.dataset.game) launchGame(button.dataset.game);
});

$('#recent-row').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-game]');
  if (button?.dataset.game) launchGame(button.dataset.game);
});

$('#hub-card').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-game]');
  if (button?.dataset.game) launchGame(button.dataset.game);
});

swatches.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-color]');
  if (button?.dataset.color) applyColor(button.dataset.color);
});

nickInput.addEventListener('input', () => applyNick(nickInput.value));
nickInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    nickInput.blur();
    enterLobby();
  }
});

$('#back-home').addEventListener('click', goHome);

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = '';
  void online.chat(text);
});

$('#wave-btn').addEventListener('click', triggerWave);
$('#play-horror').addEventListener('click', () => openGame('lobby'));

// Edytor
$('.editor__controls').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-field]');
  if (!button) return;
  const field = button.dataset.field;
  if (field === 'model') applyAppearance({ model: Number(button.dataset.index) });
  else if (field === 'skin' && button.dataset.value) applyAppearance({ skin: button.dataset.value });
  else if (field === 'hair' && button.dataset.value) applyAppearance({ hair: button.dataset.value });
  else if (field === 'outfit' && button.dataset.value) applyAppearance({ outfit: button.dataset.value });
});

$('#editor-reset').addEventListener('click', () => {
  applyAppearance({ ...DEFAULT_APPEARANCE });
  showToast(globalToast, 'Wygląd przywrócony do ustawień domyślnych.');
});

// Demonofobia
$('#game-start').addEventListener('click', startGameRound);
$('#game-cancel').addEventListener('click', exitGame);
$('#game-leave').addEventListener('click', exitGame);

gameTools.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!button) return;
  button.blur();
  if (button.dataset.tool !== undefined) world.horror.selectTool(Number(button.dataset.tool));
  else if (button.dataset.gameAction === 'light') world.horror.toggleFlashlight();
  else if (button.dataset.gameAction === 'photo') world.horror.photo();
  else if (button.dataset.gameAction === 'journal') world.horror.toggleJournal();
});

gameJournal.addEventListener('click', (event) => {
  const ghost = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-ghost]');
  if (ghost?.dataset.ghost) {
    world.horror.selectGhost(ghost.dataset.ghost);
    return;
  }
  const action = (event.target as HTMLElement).closest<HTMLElement>('[data-game-action]');
  if (action?.dataset.gameAction === 'close-journal') world.horror.toggleJournal();
});

gameResult.addEventListener('click', (event) => {
  const action = (event.target as HTMLElement).closest<HTMLElement>('[data-game-action]');
  if (!action) return;
  if (action.dataset.gameAction === 'retry') startGameRound();
  if (action.dataset.gameAction === 'exit') exitGame();
});

window.addEventListener('keydown', (event) => {
  if (
    event.key === 'Escape' &&
    handPanel.classList.contains('is-active') &&
    !game.classList.contains('is-active')
  ) {
    closeHands();
    return;
  }
  if (tutorial.classList.contains('is-active')) {
    if (event.key === 'Escape') closeTutorial();
    else if (event.key === 'ArrowRight') setTutorialStep(tutorialStep + 1);
    else if (event.key === 'ArrowLeft') setTutorialStep(tutorialStep - 1);
    return;
  }
  if (editor.classList.contains('is-active')) {
    if (event.key === 'Escape') closeEditor();
    return;
  }
  if (game.classList.contains('is-active')) {
    if (event.key === 'Escape') {
      if (!gameIntro.hidden) exitGame();
      else if (world.horror && !gameJournal.hidden) world.horror.toggleJournal();
      else if (!gameResult.hidden) exitGame();
      else exitGame();
    }
    return;
  }
  if (!lobby.classList.contains('is-active')) return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.key === 'Escape') {
    goHome();
    return;
  }
  if (event.code === 'KeyE') {
    event.preventDefault();
    triggerWave();
  }
});

// ---------------------------------------------------------- sterowanie dotykowe

/**
 * Nie ufamy tylko `(pointer: coarse)`: tablet z podpiętą myszą zgłasza fine,
 * a telefon w trybie desktopu — odwrotnie. Kontrolki włączamy też przy
 * pierwszym dotknięciu ekranu, więc hybrydowe urządzenia dostają oba światy.
 */
const touchCapable = window.matchMedia('(pointer: coarse)').matches
  || (navigator.maxTouchPoints ?? 0) > 0
  || 'ontouchstart' in window;
let touchEnabled = false;

function bindJoystick(
  element: HTMLElement,
  knob: HTMLElement,
  onChange: (x: number, y: number) => void,
): void {
  // Jeden palec na joystick, drugi może jednocześnie rozglądać się po ekranie.
  let pointerId: number | null = null;
  const update = (event: PointerEvent): void => {
    const rect = element.getBoundingClientRect();
    let dx = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    let dy = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
    const length = Math.hypot(dx, dy);
    if (length > 1) { dx /= length; dy /= length; }
    knob.style.transform = `translate(calc(-50% + ${dx * rect.width * 0.3}px), calc(-50% + ${dy * rect.height * 0.3}px))`;
    onChange(dx, -dy);
  };
  const reset = (event?: PointerEvent): void => {
    if (event && pointerId !== null && event.pointerId !== pointerId) return;
    pointerId = null;
    knob.style.transform = 'translate(-50%, -50%)';
    onChange(0, 0);
  };
  element.addEventListener('pointerdown', (event) => {
    if (pointerId !== null) return;
    pointerId = event.pointerId;
    try { element.setPointerCapture(event.pointerId); } catch { /* brak wsparcia */ }
    update(event);
  });
  element.addEventListener('pointermove', (event) => {
    if (event.pointerId === pointerId) update(event);
  });
  element.addEventListener('pointerup', (event) => reset(event));
  element.addEventListener('pointercancel', (event) => reset(event));
  element.addEventListener('lostpointercapture', () => reset());
}

/** Przytrzymanie: przechwytuje palec, więc zjazd poza przycisk nie przerywa akcji. */
function bindHoldButton(button: HTMLButtonElement, down: () => void, up: () => void): void {
  let active = false;
  const release = (event?: PointerEvent): void => {
    if (!active) return;
    if (event && button.hasPointerCapture?.(event.pointerId)) {
      try { button.releasePointerCapture(event.pointerId); } catch { /* jw. */ }
    }
    active = false;
    button.classList.remove('is-held');
    up();
  };
  button.addEventListener('pointerdown', (event) => {
    if (active) return;
    active = true;
    button.classList.add('is-held');
    try { button.setPointerCapture(event.pointerId); } catch { /* jw. */ }
    down();
  });
  button.addEventListener('pointerup', (event) => release(event));
  button.addEventListener('pointercancel', (event) => release(event));
  button.addEventListener('lostpointercapture', () => release());
}

function enableTouchControls(): void {
  if (touchEnabled || !worldReady) return;
  touchEnabled = true;
  touchControls.hidden = false;
  gameTouch.hidden = false;
  document.body.classList.add('has-touch');

  bindJoystick(joystick, joystickKnob, (x, y) => {
    if (game.classList.contains('is-active')) world.horror.setJoystick(x, y);
    else world.setJoystick(x, y);
  });
  jumpButton.addEventListener('click', () => world.jump());

  bindJoystick($('#game-joystick'), $('#game-joystick-knob'), (x, y) => {
    world.horror.setJoystick(x, y);
  });

  bindHoldButton(
    $<HTMLButtonElement>('#game-scan-btn'),
    () => world.horror.setInteracting(true),
    () => world.horror.setInteracting(false),
  );
  bindHoldButton(
    $<HTMLButtonElement>('#game-sprint-btn'),
    () => world.horror.setSprint(true),
    () => world.horror.setSprint(false),
  );
  $<HTMLButtonElement>('#game-photo-btn').addEventListener('click', () => world.horror.photo());
  $('#game-tool-btn').addEventListener('click', () => world.horror.cycleTool());
  $('#game-journal-btn').addEventListener('click', () => world.horror.toggleJournal());
  $('#game-light-btn').addEventListener('click', () => world.horror.toggleFlashlight());
}

// Hybryda (tablet + mysz): pierwsze dotknięcie ekranu dołącza kontrolki.
window.addEventListener('pointerdown', (event) => {
  if (event.pointerType !== 'mouse' && !touchEnabled) enableTouchControls();
}, { capture: true, passive: true });

// ------------------------------------------------------------------ inicjalizacja

function wireWorld(): void {
  world.onPortalSelect((id) => {
    if (id === 'demonofobia') {
      openGame('lobby');
      return;
    }
    const selected = GAMES.find((entry) => entry.id === id);
    showToast(
      lobbyToast,
      selected ? `„${selected.title}” — ${selected.ready ? 'jesteś już w tym świecie!' : 'ta gierka powstaje.'}` : 'Portal',
    );
  });
  world.onWave((name) => showToast(lobbyToast, `${name} macha do Ciebie`));
}

async function boot(): Promise<void> {
  let assets: HumanAssets | null = null;
  try {
    assets = await loadHumanAssets();
  } catch (error) {
    console.warn('Nie udało się wczytać modeli postaci:', error);
  }
  renderGameTools();
  gameHud.hidden = true;
  gameTools.hidden = true;
  gameJournal.hidden = true;
  gameResult.hidden = true;
  gameIntro.hidden = true;

  world = new World({
    color: state.color,
    name: state.nick,
    assets,
    appearance: state.appearance,
    onHorrorState: renderHorrorState,
    onHorrorFinish: showHorrorResult,
    onHorrorPhoto: captureGamePhoto,
  });
  wireWorld();
  worldReady = true;
  syncQualityLabel();
  // Auto może zmienić profil w trakcie gry — odświeżamy etykietę raz na sekundę.
  window.setInterval(syncQualityLabel, 1000);
  online.onStatus = (status) => {
    onlineStatus = status;
    renderPlayerList();
    if (status === 'offline' && chatSeeded) {
      addChatMessage('RejPlay', 'Połączenie z bazą niedostępne — gra działa lokalnie.');
    }
  };
  online.onPeers = (peers) => {
    onlinePeers = peers;
    world.updatePeers(peers);
    renderPlayerList();
  };
  online.onChat = (message) => {
    addChatMessage(message.nick, message.offline ? `${message.content} · (tylko u Ciebie)` : message.content, message.color);
  };
  void online.connect();
  window.setInterval(() => {
    online.update({
      nick: state.nick,
      color: state.color,
      appearance: state.appearance,
      mode: game.classList.contains('is-active')
        ? 'game'
        : lobby.classList.contains('is-active') ? 'lobby' : 'home',
      ...world.getPlayerState(),
    });
  }, 160);
  // Tylko dev: umożliwia testom wstrzyknąć surowy odczyt dłoni bez kamery.
  if (import.meta.env.DEV) {
    (window as unknown as { __rejplay?: { world: typeof world } }).__rejplay = { world };
  }

  nickInput.value = state.nick;
  $('#hub-name').textContent = LOBBY_NAME;
  $('#chip-nick').textContent = state.nick;
  $('#chip-avatar').textContent = state.nick.slice(0, 1).toUpperCase();
  $('#tile-nick').textContent = state.nick;
  renderFeatured();
  renderGames();
  renderFriends();
  renderRecent();
  renderSwatches();
  renderPlayerList();
  renderEditor();
  renderTutorial();
  renderLive();
  applyTheme(state.theme);
  world.mount(heroStage, 'home');

  if (touchCapable) enableTouchControls();

  if (!assets) {
    showToast(globalToast, 'Nie udało się wczytać modeli postaci — używam neutralnego podglądu zastępczego.');
  }

  bootOverlay.classList.add('is-done');
}

void boot();
