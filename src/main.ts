import './style.css';
import {
  BOTS,
  CHARACTER_MODELS,
  GAMES,
  HAIR_COLORS,
  OUTFIT_COLORS,
  PALETTE,
  SKIN_TONES,
  type GameInfo,
} from './games';
import { DEFAULT_APPEARANCE, type Appearance, type AvatarStyle } from './character';
import { loadHumanAssets, type HumanAssets } from './human';
import type { HorrorResult, HorrorState } from './horror';
import { World } from './world';

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
        outfit: OUTFIT_COLORS.some((entry) => entry.value === raw.outfit)
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
  nick: readStored('rejplay:nick') || `Kulka_${Math.floor(10 + Math.random() * 90)}`,
  color: readStored('rejplay:color') || PALETTE[0].value,
  style: (readStored('rejplay:style') === 'balls' ? 'balls' : 'human') as AvatarStyle,
  appearance: readAppearance(),
};
if (!PALETTE.some((entry) => entry.value === state.color)) state.color = PALETTE[0].value;

let photoModeActive = false;
let gameReturn: 'home' | 'lobby' = 'home';
let roundActive = false;

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
const styleSwitch = $('#style-switch');
const heroVisual = $('#hero-visual');
const visualFooter = $('#visual-footer');
const photoOverlay = $('#photo-overlay');
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
const gameTimer = $('#game-timer');
const hudNerves = $('#hud-nerves');
const hudNervesBar = $('#hud-nerves-bar');
const hudEvidence = $('#hud-evidence');
const hudToolName = $('#hud-tool-name');
const hudReading = $('#hud-reading');
const hudReadingBar = $('#hud-reading-bar');
const hudScanBar = $('#hud-scan-bar');
const hudHint = $('#hud-hint');

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

const CATEGORY_NAMES: Record<string, string> = {
  horror: 'Horror',
  social: 'Towarzyskie',
  race: 'Wyścigi',
  platform: 'Platformówki',
};

let activeCategory = 'all';
let searchQuery = '';
let featuredIndex = 0;

function renderGames(): void {
  const query = searchQuery.trim().toLowerCase();
  const visible = GAMES.filter((game) => {
    const matchesCategory = activeCategory === 'all' || game.category === activeCategory;
    const matchesQuery =
      !query ||
      `${game.title} ${game.tag} ${game.description}`.toLowerCase().includes(query);
    return matchesCategory && matchesQuery;
  });

  gameGrid.innerHTML = visible
    .map((game) => {
      const art = game.art ? `--card-art:url('${game.art}');` : '';
      return `
        <article class="game-card ${game.ready ? 'game-card--ready' : ''}" style="${art}">
          <div class="game-card__art" aria-hidden="true">
            <span class="game-card__badge">${game.ready ? 'Działa' : 'Wkrótce'}</span>
          </div>
          <div class="game-card__body">
            <span class="game-card__tag">${escapeHtml(game.tag)}</span>
            <h3>${escapeHtml(game.title)}</h3>
            <p>${escapeHtml(game.description)}</p>
            <div class="game-card__foot">
              <span class="game-card__players">◉ ${escapeHtml(game.players)}</span>
              <button
                type="button"
                class="btn btn--sm ${game.ready ? 'btn--primary' : 'btn--ghost'}"
                data-game="${game.id}"
              >
                ${game.ready ? 'Graj' : 'Zobacz'}
              </button>
            </div>
          </div>
        </article>`;
    })
    .join('');

  const shelfEmpty = $('#shelf-empty');
  shelfEmpty.hidden = visible.length > 0;
  $('#shelf-count').textContent = `${visible.length} ${visible.length === 1 ? 'świat' : 'światy'}`;
  $('#shelf-title').textContent =
    activeCategory === 'all' ? 'Popularne teraz' : CATEGORY_NAMES[activeCategory] ?? 'Katalog';
}

function renderFeatured(): void {
  const game = GAMES[featuredIndex];
  $('#featured-title').textContent = game.title;
  $('#featured-tag').textContent = CATEGORY_NAMES[game.category] ?? game.tag;
  $('#featured-desc').textContent = game.description;
  $('#featured-meta').textContent = `${game.tag} · ${game.players}`;
  $('#featured-art').style.setProperty(
    '--feat-art',
    game.art ? `url('${game.art}')` : `linear-gradient(135deg, ${game.color}, ${game.accent})`,
  );
  const play = $<HTMLButtonElement>('#featured-play');
  play.textContent = game.ready ? 'Graj teraz →' : 'Zobacz świat →';
  $('#featured-dots').innerHTML = GAMES.map(
    (entry, i) =>
      `<button type="button" class="${i === featuredIndex ? 'is-active' : ''}" data-featured="${i}" role="tab" aria-label="${escapeHtml(entry.title)}" aria-selected="${i === featuredIndex}"></button>`,
  ).join('');
}

function setFeatured(index: number): void {
  featuredIndex = (index + GAMES.length) % GAMES.length;
  renderFeatured();
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
}

function updateStyleUI(): void {
  const human = state.style === 'human' && world.hasHumans;
  heroVisual.classList.toggle('is-balls', !human);
  visualFooter.textContent = human
    ? 'Postać 3D · animacje motion capture · gesty bez VR'
    : '6 kulek · 1 awatar · klasyczny styl';
  styleSwitch.querySelectorAll<HTMLButtonElement>('[data-style]').forEach((button) => {
    const active = button.dataset.style === state.style;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function applyStyle(style: AvatarStyle): void {
  if (style === 'human' && !world.hasHumans) return;
  state.style = style;
  store('rejplay:style', style);
  world.setStyle(style);
  updateStyleUI();
  showToast(
    globalToast,
    style === 'human'
      ? 'Styl realistyczny: teksturowane postacie z animacjami.'
      : 'Styl klasyczny: awatar z sześciu kulek.',
  );
}

// ------------------------------------------------------------------- edytor

function renderEditor(): void {
  const a = state.appearance;
  modelList.innerHTML = CHARACTER_MODELS.map(
    (entry, i) => `
      <button type="button" class="option ${a.model === i ? 'is-active' : ''}" data-field="model" data-index="${i}">
        ${String(i + 1).padStart(2, '0')} · ${escapeHtml(entry.name)}
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

  skinList.innerHTML = colorRow(SKIN_TONES, 'skin', a.skin);
  hairList.innerHTML = colorRow(HAIR_COLORS, 'hair', a.hair);
  outfitList.innerHTML = colorRow(OUTFIT_COLORS, 'outfit', a.outfit);
}

function applyAppearance(patch: Partial<Appearance>): void {
  state.appearance = { ...state.appearance, ...patch };
  store('rejplay:appearance', JSON.stringify(state.appearance));
  world.setPlayerAppearance(state.appearance);
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
  const entries = [
    { name: state.nick, color: state.color, you: true },
    ...BOTS.map((bot) => ({ name: bot.name, color: bot.color, you: false })),
  ];
  playerList.innerHTML = entries
    .map(
      (entry) => `
        <li>
          <span class="player__dot" style="--dot:${entry.color}"></span>
          <span class="player__name">${escapeHtml(entry.name)}</span>
          ${entry.you ? '<span class="player__you">Ty</span>' : ''}
        </li>`,
    )
    .join('');
  playerCount.textContent = String(entries.length);
  onlineCount.textContent = `${entries.length} graczy online`;
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
  addChatMessage('Bąbel', 'siema! niezła postać :)', '#9db0aa');
  addChatMessage('Sferka', 'machnij do mnie klawiszem E!', '#c8a06a');
  addChatMessage('RejPlay', 'To demo czatu — wiadomości zostają w Twojej karcie.');
}

function setPhotoMode(enabled: boolean): void {
  if (!lobby.classList.contains('is-active')) return;
  photoModeActive = enabled;
  lobby.classList.toggle('is-photo-mode', photoModeActive);
  photoOverlay.hidden = !photoModeActive;
  world.setPhotoMode(photoModeActive);
  if (photoModeActive) {
    showToast(lobbyToast, 'Tryb aparatu · przeciągnij, żeby ustawić kadr · E = machnięcie');
  }
}

function triggerWave(): void {
  if (!lobby.classList.contains('is-active')) return;
  world.wave();
  showToast(lobbyToast, `${state.nick} macha do wszystkich 👋`);
}

function takePhoto(): void {
  const dataUrl = world.capturePhoto();
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = `rejplay-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
  link.click();
  showToast(lobbyToast, 'Zdjęcie zapisane 📸');
}

function enterLobby(): void {
  if (lobby.classList.contains('is-active')) return;
  closeEditor();
  lobby.classList.add('is-active');
  lobby.setAttribute('aria-hidden', 'false');
  home.setAttribute('aria-hidden', 'true');
  document.body.classList.add('in-lobby');
  document.body.classList.remove('in-game');
  document.title = 'Plaza Kulki · RejPlay';
  world.setPreviewClose(false);
  world.mount(lobbyStage, 'lobby');
  renderPlayerList();
  seedChat();
  showToast(lobbyToast, 'Plaza Kulki · WASD = ruch, E = machnięcie, C = aparat');
}

function goHome(): void {
  if (!lobby.classList.contains('is-active')) return;
  photoModeActive = false;
  lobby.classList.remove('is-active', 'is-photo-mode');
  photoOverlay.hidden = true;
  world.setPhotoMode(false);
  lobby.setAttribute('aria-hidden', 'true');
  home.setAttribute('aria-hidden', 'false');
  document.body.classList.remove('in-lobby');
  document.title = 'RejPlay — gry, które zaczynają się od postaci';
  chatInput.blur();
  world.mount(heroStage, 'home');
}

// -------------------------------------------------------------- HUD Zimny Ślad

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

  gameTimer.textContent = formatTime(state.seconds);
  hudNerves.textContent = String(state.nerves);
  hudNervesBar.style.width = `${state.nerves}%`;
  hudNervesBar.style.background = state.nerves < 32 ? 'var(--danger)' : 'var(--accent)';

  const tool = state.tools[state.toolIndex];
  hudToolName.textContent = tool.name;
  hudReading.textContent = `${Math.round(state.reading * 100)}%`;
  hudReadingBar.style.width = `${Math.round(state.reading * 100)}%`;
  hudScanBar.style.width = `${Math.round(state.scan * 100)}%`;
  hudHint.textContent = state.hint;

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
     <button type="button" class="tool-btn" data-game-action="journal"><kbd>J</kbd><b>Notatnik</b>złóż raport</button>`;
}

function showHorrorResult(result: HorrorResult): void {
  roundActive = false;
  showToast(gameToast, result.win ? 'Raport przyjęty. Udało się rozpoznać zjawę.' : result.reason);
}

// -------------------------------------------------------------- wejście do gry

function openGame(from: 'home' | 'lobby'): void {
  closeEditor();
  gameReturn = from;
  roundActive = false;
  lobby.classList.remove('is-active', 'is-photo-mode');
  lobby.setAttribute('aria-hidden', 'true');
  photoOverlay.hidden = true;
  game.classList.add('is-active');
  game.setAttribute('aria-hidden', 'false');
  home.setAttribute('aria-hidden', 'true');
  document.body.classList.add('in-game');
  document.body.classList.remove('in-lobby');
  document.title = 'Zimny Ślad · RejPlay';
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
  world.horror.lockPointer();
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
  if (gameReturn === 'lobby') {
    lobby.classList.add('is-active');
    lobby.setAttribute('aria-hidden', 'false');
    document.body.classList.add('in-lobby');
    document.title = 'Plaza Kulki · RejPlay';
    world.mount(lobbyStage, 'lobby');
    renderPlayerList();
  } else {
    home.setAttribute('aria-hidden', 'false');
    document.title = 'RejPlay — gry, które zaczynają się od postaci';
    world.mount(heroStage, 'home');
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
$('.sidebar').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-category]');
  if (!button?.dataset.category) return;
  activeCategory = button.dataset.category;
  $('.sidebar').querySelectorAll<HTMLButtonElement>('[data-category]').forEach((entry) => {
    entry.classList.toggle('is-active', entry === button);
  });
  renderGames();
});

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

$('#featured-dots').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-featured]');
  if (button?.dataset.featured !== undefined) setFeatured(Number(button.dataset.featured));
});

$('#featured-next').addEventListener('click', () => setFeatured(featuredIndex + 1));

$('#featured-play').addEventListener('click', () => {
  const game = GAMES[featuredIndex];
  if (game.id === 'zimny-slad') openGame('home');
  else if (game.id === 'plaza') enterLobby();
  else showToast(globalToast, `„${game.title}” jest jeszcze w przygotowaniu.`);
});

window.setInterval(() => {
  const inFullscreenView =
    document.body.classList.contains('in-lobby') || document.body.classList.contains('in-game');
  if (!inFullscreenView && !editor.classList.contains('is-active')) {
    setFeatured(featuredIndex + 1);
  }
}, 9000);

gameGrid.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-game]');
  if (!button) return;
  const selected: GameInfo | undefined = GAMES.find((entry) => entry.id === button.dataset.game);
  if (!selected) return;
  if (selected.id === 'zimny-slad') openGame('home');
  else if (selected.id === 'plaza') enterLobby();
  else showToast(globalToast, `„${selected.title}” jest jeszcze w przygotowaniu.`);
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
  addChatMessage(state.nick, text, state.color);
  chatInput.value = '';
});

styleSwitch.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-style]');
  if (button?.dataset.style === 'human' || button?.dataset.style === 'balls') {
    applyStyle(button.dataset.style);
  }
});

$('#wave-btn').addEventListener('click', triggerWave);
$('#camera-btn').addEventListener('click', () => setPhotoMode(!photoModeActive));
$('#photo-wave').addEventListener('click', triggerWave);
$('#photo-shoot').addEventListener('click', takePhoto);
$('#photo-close').addEventListener('click', () => setPhotoMode(false));
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

// Zimny Ślad
$('#game-start').addEventListener('click', startGameRound);
$('#game-cancel').addEventListener('click', exitGame);
$('#game-leave').addEventListener('click', exitGame);

gameTools.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!button) return;
  button.blur();
  if (button.dataset.tool !== undefined) world.horror.selectTool(Number(button.dataset.tool));
  else if (button.dataset.gameAction === 'light') world.horror.toggleFlashlight();
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
    if (photoModeActive) setPhotoMode(false);
    else goHome();
    return;
  }
  if (event.code === 'KeyE') {
    event.preventDefault();
    triggerWave();
  }
  if (event.code === 'KeyC') {
    event.preventDefault();
    setPhotoMode(!photoModeActive);
  }
});

// ---------------------------------------------------------- sterowanie dotykowe

const coarse = window.matchMedia('(pointer: coarse)').matches;

function bindJoystick(
  element: HTMLElement,
  knob: HTMLElement,
  onChange: (x: number, y: number) => void,
): void {
  let active = false;
  const update = (event: PointerEvent): void => {
    const rect = element.getBoundingClientRect();
    let dx = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    let dy = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
    const length = Math.hypot(dx, dy);
    if (length > 1) { dx /= length; dy /= length; }
    knob.style.transform = `translate(calc(-50% + ${dx * rect.width * 0.3}px), calc(-50% + ${dy * rect.height * 0.3}px))`;
    onChange(dx, -dy);
  };
  const reset = (): void => {
    active = false;
    knob.style.transform = 'translate(-50%, -50%)';
    onChange(0, 0);
  };
  element.addEventListener('pointerdown', (event) => {
    active = true;
    element.setPointerCapture(event.pointerId);
    update(event);
  });
  element.addEventListener('pointermove', (event) => {
    if (active) update(event);
  });
  element.addEventListener('pointerup', reset);
  element.addEventListener('pointercancel', reset);
}

function bindTouchControls(): void {
  touchControls.hidden = false;
  gameTouch.hidden = false;

  bindJoystick(joystick, joystickKnob, (x, y) => {
    if (game.classList.contains('is-active')) world.horror.setJoystick(x, y);
    else world.setJoystick(x, y);
  });
  jumpButton.addEventListener('click', () => world.jump());

  bindJoystick($('#game-joystick'), $('#game-joystick-knob'), (x, y) => {
    world.horror.setJoystick(x, y);
  });

  const scanButton = $<HTMLButtonElement>('#game-scan-btn');
  scanButton.addEventListener('pointerdown', () => world.horror.setInteracting(true));
  scanButton.addEventListener('pointerup', () => world.horror.setInteracting(false));
  scanButton.addEventListener('pointercancel', () => world.horror.setInteracting(false));
  scanButton.addEventListener('pointerleave', () => world.horror.setInteracting(false));

  $('#game-tool-btn').addEventListener('click', () => world.horror.cycleTool());
  $('#game-journal-btn').addEventListener('click', () => world.horror.toggleJournal());
  $('#game-light-btn').addEventListener('click', () => world.horror.toggleFlashlight());
}

// ------------------------------------------------------------------ inicjalizacja

function wireWorld(): void {
  world.onPortalSelect((id) => {
    if (id === 'zimny-slad') {
      openGame('lobby');
      return;
    }
    const selected = GAMES.find((entry) => entry.id === id);
    showToast(
      lobbyToast,
      selected ? `„${selected.title}” — ${selected.ready ? 'jesteś już w tym świecie!' : 'ta gierka powstaje.'}` : 'Portal',
    );
  });
  world.onWave((name) => showToast(lobbyToast, `${name} macha do Ciebie 👋`));
}

async function boot(): Promise<void> {
  let assets: HumanAssets | null = null;
  try {
    assets = await loadHumanAssets();
  } catch (error) {
    console.warn('Nie udało się wczytać modeli postaci:', error);
  }
  if (!assets) state.style = 'balls';

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
    style: state.style,
    appearance: state.appearance,
    onHorrorState: renderHorrorState,
    onHorrorFinish: showHorrorResult,
  });
  wireWorld();

  nickInput.value = state.nick;
  $('#chip-nick').textContent = state.nick;
  $('#chip-avatar').textContent = state.nick.slice(0, 1).toUpperCase();
  $('#tile-nick').textContent = state.nick;
  renderFeatured();
  renderGames();
  renderSwatches();
  renderPlayerList();
  renderEditor();
  world.mount(heroStage, 'home');
  updateStyleUI();

  if (coarse) bindTouchControls();

  if (!assets) {
    const humanButton = styleSwitch.querySelector<HTMLButtonElement>('[data-style="human"]');
    if (humanButton) humanButton.disabled = true;
    showToast(globalToast, 'Nie udało się wczytać postaci — dostępny styl klasyczny z kulek.');
  }

  bootOverlay.classList.add('is-done');
}

void boot();
