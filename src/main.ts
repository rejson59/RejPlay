import './style.css';
import {
  CHARACTER_MODELS,
  GAMES,
  LOBBY_NAME,
  HAIR_COLORS,
  OUTFITS,
  PALETTE,
  SKIN_TONES,
} from './games';
import { DEFAULT_APPEARANCE, type Appearance } from './character';
import { loadHumanAssets, type HumanAssets } from './human';
import { TOOLS, type HorrorResult, type HorrorState } from './horror';
import { World } from './world';
import { CameraRig } from './camera-rig';
import type { ControlFrame, GestureEvent, LabDiagnostics } from './camera-control';
import { handResponsiveness, setHandResponsiveness } from './hand-pose';
import {
  OnlineClient, SUPABASE_URL,
  type OnlinePeer, type OnlineStatus, type PartyState,
} from './online';
import { COMMUNITY_ANON_KEY, CommunityAccount, type CommunitySession } from './community-account';
import { AuthGate, type AuthAction } from './auth-gate';
import { ASSETS, ASSET_CATEGORIES } from './asset-catalog';
import { DialogFocus } from './dialog';
import { diagnostics as diagLog, copyDiagnosticReport } from './diagnostics';

// Bufor logów musi powstać przed jakimkolwiek innym modułem, żeby złapać
// pierwsze błędy WASM i konsoli jeszcze zanim otworzysz laboratorium.
diagLog.install();

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
let accountSession: CommunitySession | null = null;
let partyState: PartyState | null = null;
let pendingParty = new URLSearchParams(location.search).get('party')?.toUpperCase() ?? null;
const account = new CommunityAccount({
  url: SUPABASE_URL,
  key: COMMUNITY_ANON_KEY,
  onSession: (session) => {
    accountSession = session;
    online.setAccount(session);
    renderAccount();
    if (session && !readStored('rejplay:nick')) applyNick(session.username);
    if (session && pendingParty) {
      const code = pendingParty;
      pendingParty = null;
      void joinPartyByCode(code);
    }
  },
});

/** Brama konta: bez logowania/rejestracji nie ma Lobby ani rozgrywki. */
const authGate = new AuthGate({
  account,
  onResume: (action: AuthAction) => {
    if (action === 'lobby') enterLobby();
    else openGame('home');
  },
  // Brama konta zawsze na wierzchu: katalog assetów nie może jej zasłonić.
  onOpen: () => closeAssetModal(),
});

/** Wymagane konto — jedyny punkt kontroli dla Lobby i gry. */
function requireAccount(action: AuthAction): boolean {
  return authGate.require(action);
}

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
const pointerHint = $('#pointer-hint');
const pointerHintText = $('#pointer-hint-text');
const lobbyPointerHint = $('#lobby-pointer-hint');
const lobbyPointerHintText = $('#lobby-pointer-hint-text');
const lobbyCrosshair = $('#lobby-crosshair');
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
const handSpace = $('#hand-space');
const handResponsivenessInput = $<HTMLInputElement>('#hand-responsiveness');
const handResponsivenessValue = $('#hand-responsiveness-value');
// Laboratorium kamery (v0.6): jeden strumień, trzy testy, kalibracja.
const cameraLab = $('#camera-lab');
const labView = $('#lab-view');
const labFaceCanvas = $<HTMLCanvasElement>('#lab-face-canvas');
const labStatus = $('#lab-status');
const labBadge = $('#lab-badge');
const labTestHands = $('#lab-test-hands');
const labTestHead = $('#lab-test-head');
const labTestEyes = $('#lab-test-eyes');
const labProgressBar = $('#lab-progress-bar');
const labNote = $('#lab-note');
const labGaze = $<HTMLInputElement>('#lab-gaze');
const labHead = $<HTMLInputElement>('#lab-head');
const labDeadzone = $<HTMLInputElement>('#lab-deadzone');
const labSmooth = $<HTMLInputElement>('#lab-smooth');
const labInvert = $<HTMLInputElement>('#lab-invert');
const labEnable = $<HTMLButtonElement>('#lab-enable');
let autoEnabledHandsFree = false;
const lookSensitivityInput = $<HTMLInputElement>('#look-sensitivity');
const lookSensitivityValue = $('#look-sensitivity-value');
const lobbyViewToggle = $<HTMLButtonElement>('#lobby-view-toggle');
const handToggles = document.querySelectorAll<HTMLElement>('[data-hand-toggle]');
const livePill = $('#live-pill');
const liveStatus = $('#live-status');
const liveCount = $('#live-count');
const liveList = $('#live-list');
const liveSub = $('#live-sub');
const accountChip = $<HTMLButtonElement>('#account-chip');
const accountName = $('#account-name');
const partyBody = $('#party-body');
const partyCodeLabel = $('#party-code');
const chatScope = $('#chat-scope');

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
  { id: 'lobby', title: LOBBY_NAME, tag: 'Park · Lobby', art: '', ready: true },
];

let searchQuery = '';

function renderGames(): void {
  const query = searchQuery.trim().toLowerCase();
  const visible = GAMES.filter((game) =>
    !query || `${game.title} ${game.tag} ${game.description} ${game.claim} lobby park`.toLowerCase().includes(query),
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
  $('#featured-meta').textContent = `${game.tag} · ${game.players} · konto z rejson59.github.io`;
  $('#featured-art').style.setProperty('--feat-art', `url('${game.art}')`);
}

function renderFriends(): void {
  // Zero botów demonstracyjnych: wyłącznie realne Presence z Supabase.
  const peers = onlinePeers.filter((peer) => peer.mode !== 'game').slice(0, 4);
  $('#friends-count').textContent = String(peers.length);
  $('#friends-row').innerHTML = peers.length
    ? peers.map((peer) => `
        <div class="friend">
          <span class="friend__avatar" style="--fc:${escapeHtml(peer.color)}">${escapeHtml(peer.nick.slice(0, 1))}</span>
          <span>${escapeHtml(peer.nick)}</span>
          ${peer.verified ? '<span class="friend__status" title="Konto głównej strony">✓</span>' : ''}
        </div>`).join('')
    : '<div class="friend friend--empty">Nikogo jeszcze nie ma — wejdź pierwszy</div>';
}

function readRecent(): string[] {
  // v0.7: „plaza" było wewnętrznym id dawnego placu. Mapujemy zapisane
  // odwiedziny, żeby dotychczasowym graczom nie zniknęła pozycja „Ostatnio".
  try {
    const raw = JSON.parse(readStored('rejplay:recent') ?? '[]') as unknown;
    if (Array.isArray(raw)) {
      return raw
        .filter((id): id is string => typeof id === 'string')
        .map((id) => (id === 'plaza' ? 'lobby' : id))
        .slice(0, 3);
    }
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
  } else if (id === 'lobby') {
    enterLobby();
  }
}

// ------------------------------------------------------- katalog assetów 3D

let assetFilterCategory = '';

function assetIcon(category: string): string {
  return ASSET_CATEGORIES.find((entry) => entry.id === category)?.icon ?? 'i-cube';
}

/** Kafelek kategorii → otwiera modal z przefiltrowaną listą modeli. */
function renderAssetCatalog(): void {
  $('#stat-assets').textContent = String(ASSETS.length);
  $('#stat-cats').textContent = String(ASSET_CATEGORIES.length);
  $('#asset-total').textContent = `${ASSETS.length} modeli`;
  $('#asset-tiles').innerHTML = ASSET_CATEGORIES.map((cat) => `
    <button type="button" class="asset-tile" data-asset-cat="${escapeHtml(cat.id)}" title="${escapeHtml(cat.description)}">
      <span class="asset-tile__icon"><svg class="ico" aria-hidden="true"><use href="#${cat.icon}" /></svg></span>
      <b>${escapeHtml(cat.label)}</b>
      <small>${escapeHtml(cat.description)}</small>
      <span class="asset-tile__count">${cat.count}</span>
    </button>`).join('');
  renderAssetList('');
}

/** Komunikat pustego stanu mówi, co dokładnie zawęziło wyniki. */
function emptyAssetMessage(query: string, category: string): string {
  const label = ASSET_CATEGORIES.find((entry) => entry.id === category)?.label;
  const phrase = query ? ` dla frazy „${escapeHtml(query)}”` : '';
  if (label) return `Brak modeli w kategorii „${escapeHtml(label)}”${phrase}. Wyczyść filtr lub zmień wyszukiwanie.`;
  return query
    ? `Brak modelu dla frazy „${escapeHtml(query)}”. Spróbuj innej nazwy, kategorii lub licencji.`
    : 'Brak modeli do pokazania.';
}

function renderAssetList(query: string): void {
  const q = query.trim().toLowerCase();
  const visible = ASSETS.filter((asset) => {
    if (assetFilterCategory && asset.category !== assetFilterCategory) return false;
    return !q || `${asset.label} ${asset.name} ${asset.category} ${asset.license} ${asset.source}`.toLowerCase().includes(q);
  });
  $('#asset-list').innerHTML = visible.length
    ? visible.map((asset) => `
        <div class="asset-row">
          <svg class="ico" aria-hidden="true"><use href="#${assetIcon(asset.category)}" /></svg>
          <div><b>${escapeHtml(asset.label)}</b><small>${escapeHtml(asset.name)}.glb</small></div>
          <em>${escapeHtml(asset.license)}</em>
          <span>${(asset.bytes / 1024).toFixed(0)} KB</span>
        </div>`).join('')
    : `<p class="shelf__empty">${emptyAssetMessage(q, assetFilterCategory)}</p>`;
  $('#asset-total').textContent = assetFilterCategory
    ? `${visible.length} / ${ASSETS.length} modeli`
    : `${ASSETS.length} modeli`;
}

const assetModalRoot = $('#asset-modal');
const assetDialogFocus = new DialogFocus(
  assetModalRoot,
  () => assetModalRoot.classList.contains('is-active'),
);

function openAssetModal(category = ''): void {
  if (authGate.isOpen) return; // brama konta ma pierwszeństwo
  assetFilterCategory = category;
  const input = $<HTMLInputElement>('#asset-search');
  // Nazwa kategorii jest osobnym filtrem (chip poniżej), nie frazą wyszukiwania.
  input.value = '';
  const chip = $<HTMLButtonElement>('#asset-filter');
  const label = ASSET_CATEGORIES.find((c) => c.id === category)?.label;
  chip.hidden = !label;
  chip.textContent = label ? `${label} · wyczyść filtr ✕` : '';
  renderAssetList('');
  assetDialogFocus.capture();
  assetModalRoot.classList.add('is-active');
  assetModalRoot.setAttribute('aria-hidden', 'false');
  window.setTimeout(() => {
    if (assetModalRoot.classList.contains('is-active')) input.focus();
  }, 40);
}

function closeAssetModal(): void {
  if (!assetModalRoot.classList.contains('is-active')) return;
  assetModalRoot.classList.remove('is-active');
  assetModalRoot.setAttribute('aria-hidden', 'true');
  assetFilterCategory = '';
  $<HTMLButtonElement>('#asset-filter').hidden = true;
  assetDialogFocus.restore();
}

function wireAssetModal(): void {
  $('#asset-open').addEventListener('click', () => openAssetModal());
  $('#asset-tiles').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-asset-cat]');
    if (button?.dataset.assetCat) openAssetModal(button.dataset.assetCat);
  });
  assetModalRoot.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('[data-asset-close]')) closeAssetModal();
  });
  const input = $<HTMLInputElement>('#asset-search');
  input.addEventListener('input', (event) => {
    renderAssetList((event.target as HTMLInputElement).value);
  });
  $<HTMLButtonElement>('#asset-filter').addEventListener('click', () => {
    assetFilterCategory = '';
    $<HTMLButtonElement>('#asset-filter').hidden = true;
    renderAssetList(input.value);
    input.focus();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && assetModalRoot.classList.contains('is-active')) closeAssetModal();
  });
}

function wireHubNav(): void {
  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('.hub-nav__link[data-nav]'),
  );
  if (!links.length) return;
  const targetId = (nav: string): string => (nav === 'start' ? 'top' : nav);
  const activate = (nav: string): void => {
    for (const link of links) link.classList.toggle('is-active', link.dataset.nav === nav);
  };
  for (const link of links) {
    link.addEventListener('click', (event) => {
      const nav = link.dataset.nav ?? 'start';
      const target = document.getElementById(targetId(nav));
      if (!target) return; // bez sekcji zostawiamy natywny anchor
      event.preventDefault();
      activate(nav);
      target.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      });
      history.replaceState(null, '', `#${targetId(nav)}`);
    });
  }
  // Bezpośredni link z hashem (np. /RejPlay/#assets) ma podświetlić właściwą pozycję.
  const syncFromHash = (): void => {
    const hash = location.hash.slice(1);
    const match = links.find((link) => targetId(link.dataset.nav ?? '') === hash);
    if (match?.dataset.nav) activate(match.dataset.nav);
  };
  window.addEventListener('hashchange', syncFromHash);
  syncFromHash();
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

const cameraRig = new CameraRig({
  video: handVideo,
  canvas: handCanvas,
  faceCanvas: labFaceCanvas,
  onHands: (hands, aspect) => {
    // 21 punktów → 15 kątów stawów ORAZ pozycja x / y / głębokość całej dłoni.
    // Trafia na kości awatara, ramiona i dłonie first-person (gra + Lobby).
    if (worldReady) world.setHandPose(hands, aspect);
    handReadout.textContent =
      hands.length === 0
        ? 'Pokaż dłonie w kadrze'
        : hands.length === 1
          ? '1 dłoń · palce + pozycja 1:1'
          : '2 dłonie · palce + pozycja 1:1';
    renderHandSpace();
  },
  onStatus: (message, kind) => {
    diagLog.push(kind === 'error' ? 'error' : 'info', 'camera', message);
    handStatus.textContent = message;
    handStatus.classList.toggle('is-error', kind === 'error');
    labStatus.textContent = message;
    labStatus.style.color = kind === 'error' ? 'var(--danger, #e08a7a)' : '';
  },
  onControl: (control: ControlFrame, dt: number) => {
    if (worldReady) world.applyCameraControl(control, dt);
  },
  onGesture: (gesture: GestureEvent) => handleCameraGesture(gesture),
  onDiagnostics: (diagnostics: LabDiagnostics) => renderLab(diagnostics),
});
// Zachowana nazwa dla reszty kodu (panel kamerki z v0.5 działa bez zmian).
const handTracker = cameraRig;

const fmtAxis = (value: number): string =>
  `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;

/** Podgląd liczbowy: użytkownik widzi, że wysokość i głębokość też są czytane. */
function renderHandSpace(): void {
  const pair = world.handPosePair;
  const side = (pose: typeof pair.L): string => pose.present
    ? `x ${fmtAxis(pose.wrist.x)} · y ${fmtAxis(pose.wrist.y)} · z ${fmtAxis(pose.wrist.z)}`
    : '—';
  handSpace.textContent = pair.L.present || pair.R.present
    ? `Pozycja 3D · L ${side(pair.L)} · P ${side(pair.R)}`
    : 'Pozycja 3D: pokaż dłonie w kadrze';
}

const LOBBY_VIEW_KEY = 'rejplay:lobby-view';

function syncLobbyViewButton(): void {
  const fp = world.firstPersonView;
  lobbyViewToggle.innerHTML = fp
    ? 'Widok: z oczu <kbd>V</kbd>'
    : 'Widok: 3D <kbd>V</kbd>';
  lobbyViewToggle.setAttribute('aria-pressed', String(fp));
  lobbyViewToggle.title = fp
    ? 'Lobby first-person — dłonie awatara przed oczami. Kliknij, aby zobaczyć całą postać.'
    : 'Kamera za plecami. Kliknij, aby wrócić do widoku z oczu.';
}

function toggleLobbyView(): void {
  if (!worldReady) return;
  const fp = !world.firstPersonView;
  world.setFirstPerson(fp);
  try { localStorage.setItem(LOBBY_VIEW_KEY, fp ? 'fp' : 'orbit'); } catch { /* tryb prywatny */ }
  syncLobbyViewButton();
  syncLobbyPointerUI();
  showToast(
    lobbyToast,
    fp
      ? 'Widok z oczu: przeciągnij, żeby się rozejrzeć. Kamerka prowadzi dłonie w całym kadrze.'
      : 'Kamera za plecami — widzisz całą swoją postać. V wraca do widoku z oczu.',
  );
}

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
    if (lobby.classList.contains('is-active')) {
      showToast(lobbyToast, 'Kamerka działa. W widoku z oczu dłonie podążają za pozycją Twoich rąk — także w górę i w dół.');
    }
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
  handSpace.textContent = 'Pozycja 3D: pokaż dłonie w kadrze';
  syncHandButtons();
}

/** W grze panel kamerki jest schowany — nie rysujemy nieużywanego szkieletu 2D. */
function syncHandOverlay(): void {
  handTracker.setOverlayVisible(!game.classList.contains('is-active'));
}

// --------------------------------------- laboratorium kamery / VR bez VR

function handleCameraGesture(gesture: GestureEvent): void {
  if (!worldReady || !world.horror) return;
  if (gesture.type === 'aim') {
    world.horror.aimSlot(gesture.slot);
    return;
  }
  if (!game.classList.contains('is-active')) return;
  if (gesture.type === 'grab') world.horror.grabAimed();
  else if (gesture.type === 'release') world.horror.dropTool();
  else if (gesture.type === 'useStart') world.horror.setInteracting(true);
  else if (gesture.type === 'useEnd') world.horror.setInteracting(false);
}

const fmt = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;

function renderLab(d: LabDiagnostics): void {
  $('#lab-pitch').textContent = fmt(d.face?.pitch ?? 0);
  $('#lab-roll').textContent = fmt(d.face?.roll ?? 0);
  $('#lab-gaze-readout').textContent = `${fmt(d.face?.gazeX ?? 0)} / ${fmt(d.face?.gazeY ?? 0)}`;
  $('#lab-hands').textContent = `${d.hands}/2 · L ${d.left.curl.toFixed(2)} / R ${d.right.curl.toFixed(2)}`;
  $('#lab-pinch').textContent = `${d.left.pinch.toFixed(2)} / ${d.right.pinch.toFixed(2)}`;
  $('#lab-slot').textContent = String(d.slot + 1);
  $('#lab-hands-value').textContent = `${d.hands}/2`;
  $('#lab-head-value').textContent = `${Math.round(Math.min(1, d.ranges.pitch / 0.13) * 50 + Math.min(1, d.ranges.roll / 0.07) * 50)}%`;
  $('#lab-eyes-value').textContent = `${Math.round(Math.min(1, d.ranges.gazeX / 0.22) * 70 + Math.min(1, Math.max(d.ranges.gazeY / 0.14, d.ranges.blink)) * 30)}%`;
  labTestHands.classList.toggle('is-passed', d.tests.hands);
  labTestHead.classList.toggle('is-passed', d.tests.head);
  labTestEyes.classList.toggle('is-passed', d.tests.eyes);
  const passed = Number(d.calibrated) + Number(d.tests.hands) + Number(d.tests.head) + Number(d.tests.eyes);
  labProgressBar.style.width = `${(passed / 4) * 100}%`;
  // Po udanej konfiguracji włączamy sterowanie samoczynnie — od tego momentu
  // klawiatura i mysz są tylko zapasowe, nie potrzebne do gry.
  if (d.ready && !d.enabled && !autoEnabledHandsFree && cameraRig.active) {
    autoEnabledHandsFree = true;
    cameraRig.control.settings.enabled = true;
    cameraRig.control.save();
    syncLabSettings();
    showToast(globalToast, 'Konfiguracja zakończona — grasz głową, oczami i dłońmi. Klawiatura i mysz nie są potrzebne.');
  }
  labBadge.textContent = d.face?.present
    ? `twarz ✓ · źrenice ${d.face.iris ? '✓' : '—'} · dłonie ${d.hands}/2`
    : 'szukam twarzy i dłoni…';
  // Czytelny status wykrywania na słabszej kamerce: widać, czy model wstał,
  // czy klatki dochodzą i ile razy faktycznie zobaczył twarz / źrenice.
  const rig = cameraRig.diagnostics();
  const faceState = !rig.active ? 'wyłączona'
    : !rig.face.ready ? `wczytywanie…${rig.face.lastError ? ` (${rig.face.lastError})` : ''}`
      : `gotowy · klatek ${rig.face.framesSent} · twarzy ${rig.face.faces} · źrenic ${rig.face.irisFrames}`;
  const handState = !rig.active ? 'wyłączone'
    : !rig.hands.ready ? 'wczytywanie…'
      : `gotowe · klatek ${rig.hands.framesSent} · odczytów ${rig.hands.results}`;
  $('#lab-detect').textContent =
    `Dłonie: ${handState}  |  Głowa/oczy: ${faceState}  |  kadr ${rig.video}  |  ${rig.constraint}`;
  labEnable.disabled = !d.ready && !d.enabled;
  labEnable.textContent = d.enabled
    ? 'Wyłącz sterowanie bez klawiatury'
    : d.ready ? 'Włącz grę bez klawiatury' : 'Wykonaj testy i kalibrację';
  if (!d.settings.enabled) {
    labNote.textContent = d.ready
      ? 'Wszystkie testy zaliczone. Włącz sterowanie — od teraz głowa, oczy i dłonie wystarczą.'
      : 'Kalibracja: patrz prosto przez ~2 s. Potem pokaż dłonie, kiwnij głową i rozejrzyj się oczami.';
  }
}

function syncLabSettings(): void {
  const s = cameraRig.control.settings;
  labGaze.value = String(s.gazeSensitivity);
  labHead.value = String(s.headSensitivity);
  labDeadzone.value = String(s.deadzone);
  labSmooth.value = String(s.smoothing);
  labInvert.checked = s.invertX;
  $('#lab-gaze-value').textContent = `${s.gazeSensitivity.toFixed(2)}×`;
  $('#lab-head-value-out').textContent = `${s.headSensitivity.toFixed(2)}×`;
  $('#lab-deadzone-value').textContent = s.deadzone.toFixed(2);
  $('#lab-smooth-value').textContent = s.smoothing.toFixed(2);
  labEnable.textContent = s.enabled ? 'Wyłącz sterowanie bez klawiatury' : 'Włącz grę bez klawiatury';
}

async function openCameraLab(): Promise<void> {
  cameraLab.classList.add('is-active');
  cameraLab.setAttribute('aria-hidden', 'false');
  // Jeden i ten sam element <video>: przenosimy go do laboratorium, żeby nie
  // prosić o drugą zgodę na kamerę i nie mnożyć strumieni.
  labView.insertBefore(handVideo, labView.firstChild);
  labView.insertBefore(handCanvas, labFaceCanvas);
  handPanel.classList.remove('is-active');
  handPanel.setAttribute('aria-hidden', 'true');
  cameraRig.setLabOpen(true);
  syncLabSettings();
  renderLab(cameraRig.control.diagnostics());
  if (!handTracker.active) {
    labStatus.textContent = 'Uruchamianie kamerki…';
    try {
      await handTracker.start();
    } catch (error) {
      labStatus.textContent = error instanceof Error ? error.message : String(error);
      labBadge.textContent = 'Kamerka niedostępna';
    }
  }
  syncHandButtons();
  cameraRig.setOverlayVisible(true);
}

// ------------------------------------------- logi do skopiowania (v0.6.1)

const logPanel = $('#log-panel');
const logText = $<HTMLTextAreaElement>('#log-text');
const logCount = $('#log-count');

function refreshLogText(): void {
  logText.value = diagLog.report();
  logCount.textContent = `${diagLog.count} zdarzeń · ${diagLog.errorCount} błędów`;
}

function openLogPanel(): void {
  refreshLogText();
  logPanel.classList.add('is-active');
  logPanel.setAttribute('aria-hidden', 'false');
  logText.focus();
  logText.setSelectionRange(0, logText.value.length);
}

function closeLogPanel(): void {
  logPanel.classList.remove('is-active');
  logPanel.setAttribute('aria-hidden', 'true');
}

async function copyLogs(): Promise<void> {
  const result = await copyDiagnosticReport();
  if (result === 'copied') {
    showToast(globalToast, 'Logi skopiowane — wklej je tutaj na czacie (Ctrl+V).');
  } else {
    openLogPanel();
    showToast(globalToast, 'Schowek zablokowany — logi są otwarte, zaznacz i skopiuj ręcznie.');
  }
}

async function restartCamera(): Promise<void> {
  diagLog.push('info', 'camera', 'Ręczny restart kamerki.');
  showToast(globalToast, 'Restartuję kamerki i oba modele…');
  try {
    await cameraRig.restart();
    showToast(globalToast, 'Kamerka uruchomiona ponownie.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    diagLog.push('error', 'camera', `restart(): ${message}`);
    showToast(globalToast, message);
  }
}

$('#log-copy').addEventListener('click', () => void copyLogs());
$('#log-refresh').addEventListener('click', refreshLogText);
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !logPanel.classList.contains('is-active')) return;
  event.stopPropagation();
  closeLogPanel();
}, true);

function closeCameraLab(): void {
  cameraLab.classList.remove('is-active');
  cameraLab.setAttribute('aria-hidden', 'true');
  cameraRig.setLabOpen(false);
  const view = document.querySelector<HTMLElement>('.hand-panel__view');
  if (view) {
    view.insertBefore(handVideo, view.firstChild);
    view.appendChild(handCanvas);
  }
  if (handTracker.active) {
    // Po wyjściu z laboratorium panel kamerki wraca — są w nim przyciski
    // „Kopiuj logi" / „Restart kamerki", potrzebne także poza laboratorium.
    handPanel.classList.add('is-active', 'is-on');
    handPanel.setAttribute('aria-hidden', 'false');
  } else {
    handPanel.setAttribute('aria-hidden', 'true');
  }
  syncHandOverlay();
}

([
  [labGaze, 'gazeSensitivity', $('#lab-gaze-value'), '×'],
  [labHead, 'headSensitivity', $('#lab-head-value-out'), '×'],
  [labDeadzone, 'deadzone', $('#lab-deadzone-value'), ''],
  [labSmooth, 'smoothing', $('#lab-smooth-value'), ''],
] as Array<[HTMLInputElement, 'gazeSensitivity' | 'headSensitivity' | 'deadzone' | 'smoothing', HTMLElement, string]>).forEach(
  ([input, key, output, suffix]) => {
    input.addEventListener('input', () => {
      cameraRig.control.settings[key] = Number(input.value);
      cameraRig.control.save();
      output.textContent = `${Number(input.value).toFixed(2)}${suffix}`;
    });
  },
);
labInvert.addEventListener('change', () => {
  cameraRig.control.settings.invertX = labInvert.checked;
  cameraRig.control.save();
});
$('#lab-calibrate').addEventListener('click', () => {
  cameraRig.recaptureNeutral();
  labNote.textContent = 'Kalibruję… patrz prosto w kamerę i nie ruszaj głową.';
  window.setTimeout(() => {
    const ok = cameraRig.control.finishCalibration();
    labNote.textContent = ok
      ? 'Pozycja neutralna zapisana. Teraz wykonaj trzy testy ruchu.'
      : 'Za mało klatek twarzy — ustaw się bliżej kamery i spróbuj ponownie.';
  }, 2300);
});
$('#lab-reset').addEventListener('click', () => {
  cameraRig.control.resetTests();
  labNote.textContent = 'Testy zresetowane. Pokaż dłonie, kiwnij głową i rozejrzyj się oczami.';
});
labEnable.addEventListener('click', () => {
  const control = cameraRig.control;
  control.settings.enabled = !control.settings.enabled;
  control.save();
  syncLabSettings();
  showToast(
    globalToast,
    control.settings.enabled
      ? 'Sterowanie bez klawiatury WŁĄCZONE: głowa = ruch, oczy = kamera, palce = narzędzia.'
      : 'Sterowanie kamerą wyłączone. Klawiatura, mysz i dotyk działają normalnie.',
  );
});

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
    { name: state.nick, color: state.color, you: true, live: onlineStatus === 'online', verified: Boolean(accountSession) },
    ...real.map((peer) => ({
      name: peer.nick, color: peer.color, you: false, live: true, verified: Boolean(peer.verified),
    })),
  ];
  playerList.innerHTML = entries
    .map(
      (entry) => `
        <li>
          <span class="player__dot" style="--dot:${entry.color}"></span>
          <span class="player__name">${escapeHtml(entry.name)}</span>
          ${entry.you ? '<span class="player__you">Ty</span>' : ''}
          ${entry.live ? '<span class="player__live" title="Gracz online">●</span>' : ''}
          ${entry.verified ? '<span class="player__live" title="Konto rejson59.github.io">✓</span>' : ''}
        </li>`,
    )
    .join('');
  playerCount.textContent = String(entries.length);
  onlineCount.textContent = partyState
    ? `Drużyna ${partyState.code} · ${real.length + 1} ${real.length ? 'graczy' : 'gracz'}`
    : onlineStatus === 'offline'
      ? 'Brak połączenia · tylko Ty'
      : `${real.length + 1} ${real.length ? 'graczy' : 'gracz'} online · bez botów`;
  chatScope.textContent = partyState ? `Drużyna ${partyState.code}` : 'Lobby · wszyscy';
  renderLive();
  renderFriends();
}

/** Przycisk konta w górnym pasku — jedno konto na całą stronę rejson59. */
function renderAccount(): void {
  const signed = Boolean(accountSession);
  accountChip.classList.toggle('is-signed', signed);
  accountName.textContent = signed ? accountSession!.username : 'Zaloguj się';
  accountChip.title = signed
    ? `Konto rejson59.github.io: ${accountSession!.username} · kliknij, aby wylogować`
    : 'Zaloguj się lub zarejestruj — bez konta nie rozpoczniesz gry';
  authGate.render(accountSession);
}

function loginInfo(): string {
  return 'Jedno konto na <b>rejson59.github.io</b> i w RejPlay. Zaloguj się lub zarejestruj, aby grać.';
}

async function joinPartyByCode(code: string): Promise<void> {
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  if (clean.length < 4) {
    showToast(lobbyToast, 'Kod drużyny ma 4–10 znaków.');
    return;
  }
  if (!accountSession) {
    pendingParty = clean;
    try { localStorage.setItem('rejplay:pending-party', clean); } catch { /* opcjonalne */ }
    showToast(lobbyToast, 'Zaloguj się lub zarejestruj w RejPlay, potem dołączysz do drużyny.');
    return;
  }
  const result = await online.joinParty(clean);
  if (!result.ok) showToast(lobbyToast, result.error ?? 'Nie udało się dołączyć.');
  else {
    try { localStorage.removeItem('rejplay:pending-party'); } catch { /* jw. */ }
    showToast(lobbyToast, `Dołączyłeś do drużyny ${result.code}.`);
  }
}

function renderParty(state: PartyState | null): void {
  partyState = state;
  partyCodeLabel.textContent = state ? state.code : 'brak';
  if (!accountSession) {
    partyBody.innerHTML = `
      <p class="party__hint">${loginInfo()}</p>
      <div class="party__actions">
        <button type="button" data-party-action="login">Zaloguj / zarejestruj</button>
      </div>
      ${pendingParty ? `<p class="party__hint">Zaproszenie do drużyny <b>${escapeHtml(pendingParty)}</b> czeka na zalogowanie.</p>` : ''}`;
  } else if (!state) {
    partyBody.innerHTML = `
      <div class="party__row">
        <input id="party-input" type="text" maxlength="10" placeholder="Kod drużyny" aria-label="Kod drużyny" />
        <button type="button" data-party-action="join">Dołącz</button>
      </div>
      <div class="party__actions">
        <button type="button" data-party-action="create">Utwórz drużynę</button>
        <button type="button" data-party-action="logout">Wyloguj</button>
      </div>
      <p class="party__hint">Kodem zaproszenia możesz podzielić się ze znajomymi. Czat i Lobby zawężają się wtedy tylko do Waszej drużyny.</p>`;
  } else {
    const members = state.members ?? [];
    partyBody.innerHTML = `
      <div class="party__code">${escapeHtml(state.code)}</div>
      <ul class="party__members">
        ${members.map((member) => `<li><i style="background:${escapeHtml(member.color)}"></i>${escapeHtml(member.nick)}${member.userId === state.leader ? ' ★' : ''}</li>`).join('')}
      </ul>
      <div class="party__actions">
        <button type="button" data-party-action="invite">Kopiuj zaproszenie</button>
        ${state.userId === state.leader ? '<button type="button" data-party-action="start">Rozpocznij razem</button>' : ''}
        <button type="button" data-party-action="leave">Opuść</button>
      </div>
      <p class="party__hint">Zalogowany: <b>${escapeHtml(accountSession!.username)}</b>. Token jest sprawdzany w bazie, nie w przeglądarce.</p>`;
  }
  renderPlayerList();
}

partyBody.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>('[data-party-action]');
  if (!button) return;
  const action = button.dataset.partyAction;
  button instanceof HTMLButtonElement && button.blur();
  if (action === 'login') {
    authGate.open();
  } else if (action === 'logout') {
    account.logout();
    try { localStorage.removeItem('rejplay:pending-party'); } catch { /* jw. */ }
    showToast(lobbyToast, 'Wylogowano z konta głównej strony.');
  } else if (action === 'join') {
    const value = partyBody.querySelector<HTMLInputElement>('#party-input')?.value ?? '';
    void joinPartyByCode(value);
  } else if (action === 'create') {
    void online.createParty('Drużyna').then((result) => {
      if (!result.ok) showToast(lobbyToast, result.error ?? 'Nie utworzono drużyny.');
      else showToast(lobbyToast, `Drużyna ${result.code} · wyślij kod znajomym.`);
    });
  } else if (action === 'leave') {
    void online.leaveParty().then(() => showToast(lobbyToast, 'Opuściłeś drużynę. Wracasz do Lobby.'));
  } else if (action === 'invite') {
    const url = online.inviteUrl();
    if (url) {
      void navigator.clipboard?.writeText(url).then(
        () => showToast(lobbyToast, 'Link z kodem skopiowany do schowka.'),
        () => showToast(lobbyToast, `Zaproszenie: ${url}`),
      );
    }
  } else if (action === 'start') {
    online.startPartyRound();
    showToast(lobbyToast, 'Wysłano sygnał „rozpocznij razem”.');
  }
});

accountChip.addEventListener('click', () => {
  // Zalogowany widzi panel z wylogowaniem, gość — formularz logowania.
  authGate.open();
});

/** Panel „Na żywo” na stronie głównej — wyłącznie prawdziwe dane z presence. */
function renderLive(): void {
  const real = onlinePeers.filter((peer) => peer.mode !== 'game');
  livePill.classList.toggle('is-online', onlineStatus === 'online');
  livePill.classList.toggle('is-offline', onlineStatus === 'offline');
  liveStatus.textContent =
    onlineStatus === 'online' ? `${real.length + 1} online` :
    onlineStatus === 'offline' ? 'Tryb offline' : 'Łączę…';
  liveSub.textContent =
    onlineStatus === 'online' ? 'Supabase Realtime · Lobby' :
    onlineStatus === 'offline' ? 'Brak połączenia · podgląd i katalog działają' : 'Supabase Realtime · łączenie…';
  // Offline nikogo nie udajemy: nawet lokalny gracz nie jest „na żywo”.
  const offline = onlineStatus === 'offline';
  liveCount.textContent = String(offline ? real.length : real.length + 1);
  const rows = offline ? [] : [
    `<li><i style="background:${escapeHtml(state.color)}"></i>${escapeHtml(state.nick)} (Ty)</li>`,
    ...real.map(
      (peer) => `<li><i style="background:${escapeHtml(peer.color)}"></i>${escapeHtml(peer.nick)} · ${peer.mode === 'lobby' ? 'Lobby' : 'Start'}</li>`,
    ),
  ];
  if (real.length === 0) {
    rows.push(offline
      ? '<li class="is-empty">Brak połączenia — nikt nie jest widoczny</li>'
      : '<li class="is-empty">Nikogo jeszcze nie ma — wejdź pierwszy</li>');
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
      ? `Czat przez Supabase${partyState ? ` · tylko drużyna ${partyState.code}` : ' · Lobby'}.`
      : 'Brak połączenia z bazą — wiadomości zostają w tej karcie.',
  );
}

function triggerWave(): void {
  if (game.classList.contains('is-active')) return;
  world.wave();
  online.sendWave();
  showToast(
    lobby.classList.contains('is-active') ? lobbyToast : globalToast,
    `${state.nick} macha do wszystkich`,
  );
}

/**
 * Foto-dowód zostaje WYŁĄCZNIE w grze: licznik w notatniku + uspokojenie
 * nerwów / przerwanie nalotu. Nie tworzymy pliku PNG ani pobierania — zgodnie
 * z decyzją użytkownika „zapisywanie dowodu jako PNG jest niepotrzebne”.
 */
function captureGamePhoto(): void {
  online.event('photo');
  showToast(gameToast, 'Foto-dowód zanotowany · bez zapisywania pliku');
}

function enterLobby(): void {
  if (!requireAccount('lobby')) return;
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
  // Nie przejmujemy kursora automatycznie: w Lobby jest sporo klikalnego UI
  // (czat, narzędzia, kamerka). Gracz wchodzi w lock jednym klikiem w widok 3D.
  syncLobbyPointerUI();
  online.update({ mode: 'lobby' });
  renderPlayerList();
  seedChat();
  recordVisit('lobby');
  online.event('lobby_enter');
  showToast(lobbyToast, `${LOBBY_NAME} · widok z oczu: WASD = ruch, przeciągnij = rozglądanie, V = kamera 3D`);
  lobby.focus({ preventScroll: true });
}

function goHome(): void {
  if (!lobby.classList.contains('is-active')) return;
  lobby.classList.remove('is-active');
  lobby.setAttribute('aria-hidden', 'true');
  home.setAttribute('aria-hidden', 'false');
  document.body.classList.remove('in-lobby');
  releasePointerLock();
  syncLobbyPointerUI();
  document.title = 'RejPlay — Demonofobia i Lobby';
  chatInput.blur();
  online.update({ mode: 'home' });
  world.mount(heroStage, 'home');
  renderRecent();
  home.focus({ preventScroll: true });
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
  hudToolName.textContent = state.held < 0 ? 'Pusta dłoń' : tool.name;
  cameraRig.control.setHeld(state.held);
  const slotEl = $('#lab-slot');
  slotEl.dataset.slot = String(state.aimedSlot);
  slotEl.textContent = String(state.aimedSlot + 1);
  hudReading.textContent = `${Math.round(state.reading * 100)}%`;
  hudReadingBar.style.width = `${Math.round(state.reading * 100)}%`;
  hudScanBar.style.width = `${Math.round(state.scan * 100)}%`;
  hudHint.textContent = `${state.hunting ? 'NALOT · ' : ''}${state.nearBase ? 'BAZA · ' : ''}${state.hint}`;
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
    const index = Number(button.dataset.tool);
    button.classList.toggle('is-active', index === state.held);
    button.classList.toggle('is-aimed', index === state.aimedSlot);
    const label = button.querySelector<HTMLElement>('.belt-state');
    if (label) label.textContent = index === state.held ? 'w dłoni' : 'na pasie';
  });
  const lightButton = gameTools.querySelector<HTMLButtonElement>('[data-game-action="light"]');
  if (lightButton) lightButton.classList.toggle('is-active', state.flashlight);

  gameJournal.hidden = !state.journal;
  // Notatnik ma klikalne karty zjaw, a ekran wyniku przyciski — kursor musi
  // być wolny. Po zamknięciu notatnika klawiszem J przejmujemy go z powrotem.
  if (state.journal || state.result) releasePointerLock();
  syncPointerHint();
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
  // Pas na biodrach: te same sloty co w modelu 3D (src/tool-belt.ts).
  gameTools.innerHTML =
    TOOLS
      .map(
        (tool, i) => `
        <button type="button" class="tool-btn tool-btn--belt" data-tool="${i}">
          <kbd>${tool.key}</kbd><b>${escapeHtml(tool.name)}</b><span class="belt-state">na pasie</span>
        </button>`,
      )
      .join('') +
    `<button type="button" class="tool-btn" data-game-action="drop"><kbd>Q</kbd><b>Odłóż</b>na pas</button>
     <button type="button" class="tool-btn" data-game-action="light"><kbd>F</kbd><b>Latarka</b>włącz / wyłącz</button>
     <button type="button" class="tool-btn" data-game-action="photo"><kbd>P</kbd><b>Foto-dowód</b>tylko w grze · <span id="game-photo-count">0</span></button>
     <button type="button" class="tool-btn" data-game-action="journal"><kbd>J</kbd><b>Notatnik</b>złóż raport</button>`;
}

function showHorrorResult(result: HorrorResult): void {
  online.event(result.win ? 'game_win' : 'game_fail', result.ghost);
  roundActive = false;
  pointerLockArmed = false;
  releasePointerLock();
  syncPointerHint();
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
    tag: 'VR bez VR',
    title: 'Najpierw laboratorium kamery',
    text: 'Otwórz Laboratorium kamery (lewy pasek albo ekran startowy gry), skalibruj patrząc prosto i wykonaj trzy testy: dłonie, głowa, oczy. Potem przechył głowy prowadzi postać, źrenice obracają kamerę, a palce biorą narzędzia z pasa — klawiatura i mysz nie są potrzebne.',
    glyph: '◉  ✋  ◎',
    caption: 'jedna kamerka · trzy tory sterowania',
  },
  {
    tag: 'Ruch',
    title: 'Wejdź do domu i rozejrzyj się',
    text: 'Klawisze W A S D prowadzą postać. Po starcie gra przechwytuje kursor, więc myszką obrócisz się o dowolny kąt — także przy dwóch monitorach. Esc zwalnia kursor do klikania HUD-u, klik w widok przejmuje go z powrotem. Shift to sprint, [ i ] zmieniają czułość. Na telefonie użyj joysticka i przeciągnij palcem.',
    glyph: 'W A S D',
    caption: 'pełny obrót 360° z blokadą kursora',
  },
  {
    tag: 'Pas na biodrach',
    title: 'Weź narzędzie z pasa',
    text: 'Startujesz przy samochodzie-bazie. Na pasie jest sześć przyrządów: klawisze 1–6 (albo spójrz w dół i zaciśnij palce) biorą wybrany, Q lub otwarta dłoń odkłada. Termometr, miernik pola, rejestrator, latarka UV, czujnik ruchu i kamera nocna szukają sześciu różnych śladów.',
    glyph: '1 … 6',
    caption: 'sześć narzędzi, sześć śladów',
  },
  {
    tag: 'Skan',
    title: 'Przytrzymaj E przy śladzie',
    text: 'Podejdź do punktu z aktywnym narzędziem i przytrzymaj E (albo zaciśnij palce) około sekundy. Pasek skanu się zapełni, a w notatniku pojawi się „wykryto" albo „brak". Zbadaj wszystkie sześć śladów, zanim zgadujesz.',
    glyph: 'E',
    caption: 'przytrzymaj ~1 s',
  },
  {
    tag: 'Foto-dowód',
    title: 'Zrób zdjęcie klawiszem P',
    text: 'Foto-dowód działa tylko wewnątrz rozgrywki — bez pliku PNG i bez pobierania. Zdjęcie zrobione przy silnym odczycie trochę uspokaja nerwy, a podczas nalotu potrafi go przerwać, jeśli uchwycisz sylwetkę.',
    glyph: 'P',
    caption: 'bez pliku PNG, bez pobierania',
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

// --------------------------------------- blokada kursora / pełny obrót 360°
// Bez pointer locku przy dwóch monitorach kursor ucieka poza okno, a przeglądarka
// przestaje wysyłać movementX/Y — obrót „staje” na krawędzi ekranu. Blokada
// daje nieograniczone delty myszy. Zwalniamy ją dla notatnika, wyniku i na Esc,
// żeby ich przyciski (karty zjaw, wyjście) nadal dało się kliknąć. Działa tak
// samo w grze i w first-person Lobby; tam klik z celownikiem używa portalu.
const mouseCapable = window.matchMedia('(pointer: fine)').matches;
/** Hybridowe laptopy/tablety: dotyk nie powinien wywoływać blokady kursora. */
let lastPointerType = 'mouse';
document.addEventListener('pointerdown', (event) => {
  lastPointerType = event.pointerType;
}, true);
let pointerLockArmed = false;
let lobbyLockArmed = false;
let pointerWasLocked = false;
let pointerLockDenied = false;
let lastPointerUnlock = -10000;
/** Krótkie okno tylko na ten sam klawisz Esc, który zwolnił kursor. */
const UNLOCK_GRACE_MS = 220;

function activeCanvas(): HTMLCanvasElement | null {
  if (game.classList.contains('is-active')) return gameStage.querySelector('canvas');
  if (lobby.classList.contains('is-active')) return lobbyStage.querySelector('canvas');
  return null;
}

function pointerLocked(): boolean {
  const canvas = activeCanvas();
  return Boolean(canvas && document.pointerLockElement === canvas);
}

function gameLockAllowed(): boolean {
  return Boolean(roundActive && pointerLockArmed && gameIntro.hidden
    && gameJournal.hidden && gameResult.hidden);
}

function lobbyLockAllowed(): boolean {
  return lobbyLockArmed && worldReady && world.firstPersonView
    && lobby.classList.contains('is-active');
}

function plainPointerLock(canvas: HTMLCanvasElement): void {
  try {
    const result = canvas.requestPointerLock() as Promise<void> | void;
    if (result && typeof result.catch === 'function') {
      result.catch(() => { pointerLockDenied = true; syncPointerHint(); });
    }
  } catch {
    pointerLockDenied = true;
    syncPointerHint();
  }
}

function requestPointerLock(force = false): void {
  if (!mouseCapable || !worldReady || pointerLocked()) return;
  if (!force && !gameLockAllowed() && !lobbyLockAllowed()) return;
  const canvas = activeCanvas();
  if (!canvas) return;
  // Surowy ruch bez akceleracji systemowej = prawdziwe 1:1 myszy. Opcja nie
  // jest wszędzie dostępna, więc odrzucenie/ wyjątek odpala zwykły wariant.
  try {
    const opts = { unadjustedMovement: true } as PointerLockOptions;
    const result = canvas.requestPointerLock(opts) as Promise<void> | void;
    if (result && typeof result.catch === 'function') result.catch(() => plainPointerLock(canvas));
  } catch {
    plainPointerLock(canvas);
  }
}

function releasePointerLock(): void {
  if (document.pointerLockElement) document.exitPointerLock();
}

function syncPointerHint(): void {
  const locked = pointerLocked();
  const g = gameLockAllowed();
  const l = lobbyLockAllowed();
  document.body.classList.toggle('pointer-locked', locked);
  pointerHint.classList.toggle('is-visible', g && !locked);
  lobbyPointerHint.classList.toggle('is-visible', l && !locked);
  lobbyCrosshair.classList.toggle('is-on', l && locked);
  pointerHintText.textContent = pointerLockDenied
    ? 'Przeglądarka odmówiła przechwycenia kursora. Otwórz stronę w nowej karcie albo przytrzymaj lewy przycisk i trzymaj kursor przy krawędzi okna — obrót będzie ciągły.'
    : 'Kliknij w widok, aby znów rozglądać się w pełnym zakresie 360°.';
  lobbyPointerHintText.textContent = pointerLockDenied
    ? 'Brak blokady kursora: przytrzymaj lewy przycisk i trzymaj kursor przy krawędzi okna, albo otwórz stronę w nowej karcie.'
    : 'Kliknij w widok, by przechwycić kursor i rozglądać się bez końca. Celownik + klik otwierają portal.';
}

document.addEventListener('pointerlockchange', () => {
  const locked = pointerLocked();
  if (pointerWasLocked && !locked) lastPointerUnlock = performance.now();
  pointerWasLocked = locked;
  if (locked) pointerLockDenied = false;
  syncPointerHint();
});
document.addEventListener('pointerlockerror', () => {
  pointerLockDenied = true;
  syncPointerHint();
});

/** Stan FP w Lobby: uzbraja lock, pokazuje celownik i zwalnia kursor w 3D. */
function syncLobbyPointerUI(): void {
  const fp = worldReady && lobby.classList.contains('is-active') && world.firstPersonView;
  document.body.classList.toggle('in-lobby-fp', fp);
  lobbyLockArmed = fp && mouseCapable;
  if (!fp && document.pointerLockElement) releasePointerLock();
  lobbyCrosshair.classList.remove('is-aimed');
  syncPointerHint();
}

// Klik w sam widok 3D wznawia blokadę. HUD, narzędzia i notatnik są rodzeństwem
// #game-stage, więc ich przyciski nie wywołają przejęcia kursora.
gameStage.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'touch') return;
  requestPointerLock();
});

lobbyStage.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'touch' || !worldReady || !world.firstPersonView) return;
  // Przy już przechwyconym kursorze klik = „użyj” tego, co pod celownikiem.
  if (pointerLocked()) {
    world.useFirstPersonPortal();
    return;
  }
  // Przy wolnym kursorze klik w portal wchodzi do gry (nie zabieramy kursora),
  // a klik w pusty widok przejmuje go i pozwala rozglądać się w nieskończoność.
  if (!world.tryLobbyClick(event.clientX, event.clientY)) requestPointerLock();
});

// ------------------------------------------------------------------ ustawienia

const LOOK_KEY = 'rejplay:look-sensitivity';
const HAND_KEY = 'rejplay:hand-responsiveness';
let lookSensitivity = 1;

function applyLookSensitivity(value: number, announce = false): void {
  lookSensitivity = Math.min(2, Math.max(0.6, value));
  if (worldReady) world.horror.setLookSensitivity(lookSensitivity);
  lookSensitivityInput.value = String(lookSensitivity);
  lookSensitivityValue.textContent = `${lookSensitivity.toFixed(2).replace(/0$/, '')}×`;
  try { localStorage.setItem(LOOK_KEY, String(lookSensitivity)); } catch { /* tryb prywatny */ }
  if (announce) showToast(gameToast, `Czułość myszy: ${lookSensitivityValue.textContent} ([ / ] zmieniają w każdej chwili)`);
}

function applyHandResponsiveness(value: number): void {
  const v = Math.min(2.2, Math.max(0.45, value));
  setHandResponsiveness(v);
  handResponsivenessInput.value = String(v);
  handResponsivenessValue.textContent = v < 0.8 ? 'Płynnie' : v > 1.25 ? 'Bardzo 1:1' : '1:1';
  try { localStorage.setItem(HAND_KEY, String(v)); } catch { /* tryb prywatny */ }
}

// -------------------------------------------------------------- wejście do gry

function openGame(from: 'home' | 'lobby'): void {
  if (!requireAccount('game')) return;
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
  releasePointerLock();
  lobbyLockArmed = false;
  pointerLockArmed = false;
  syncLobbyPointerUI();
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
  game.focus({ preventScroll: true });
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
  // To wciąż ten sam gest kliknięcia „Rozpocznij” — można przejąć kursor.
  pointerLockArmed = mouseCapable && lastPointerType !== 'touch';
  lobbyLockArmed = false;
  requestPointerLock(true);
  syncPointerHint();
  online.event('game_start');
  showToast(gameToast, 'Przytrzymaj E, aby skanować. 1 / 2 / 3 zmieniają narzędzia.');
}

function exitGame(): void {
  roundActive = false;
  pointerLockArmed = false;
  releasePointerLock();
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
    lobby.focus({ preventScroll: true });
  } else {
    home.setAttribute('aria-hidden', 'false');
    document.title = 'RejPlay — Demonofobia i Lobby';
    world.mount(heroStage, 'home');
    renderRecent();
    home.focus({ preventScroll: true });
  }
  // Powrót do Lobby FP musi na nowo uzbroić lock i celownik.
  syncLobbyPointerUI();
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
    case 'open-camera-lab':
      void openCameraLab();
      break;
    case 'close-camera-lab':
      closeCameraLab();
      break;
    case 'copy-logs':
      void copyLogs();
      break;
    case 'show-logs':
      openLogPanel();
      break;
    case 'close-log-panel':
      closeLogPanel();
      break;
    case 'restart-camera':
      void restartCamera();
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
lobbyViewToggle.addEventListener('click', toggleLobbyView);
lookSensitivityInput.addEventListener('input', () => applyLookSensitivity(Number(lookSensitivityInput.value)));
handResponsivenessInput.addEventListener('input', () => applyHandResponsiveness(Number(handResponsivenessInput.value)));
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
  if (button.dataset.tool !== undefined) world.horror.takeTool(Number(button.dataset.tool));
  else if (button.dataset.gameAction === 'drop') world.horror.dropTool();
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
  if (action?.dataset.gameAction === 'close-journal') {
    world.horror.toggleJournal();
    requestPointerLock(true);
  }
});

gameResult.addEventListener('click', (event) => {
  const action = (event.target as HTMLElement).closest<HTMLElement>('[data-game-action]');
  if (!action) return;
  if (action.dataset.gameAction === 'retry') startGameRound();
  if (action.dataset.gameAction === 'exit') exitGame();
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && cameraLab.classList.contains('is-active')) {
    closeCameraLab();
    return;
  }
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
      // Pierwsze Esc tylko zwalnia kursor. Przeglądarka robi to sama i czasem
      // w ogóle nie dostarcza keydown, więc oba porządki zdarzeń są obsłużone.
      if (pointerLocked() || performance.now() - lastPointerUnlock < UNLOCK_GRACE_MS) {
        releasePointerLock();
        syncPointerHint();
        return;
      }
      if (!gameIntro.hidden) exitGame();
      else if (world.horror && !gameJournal.hidden) world.horror.toggleJournal();
      else if (!gameResult.hidden) exitGame();
      else exitGame();
      return;
    }
    if (event.code === 'KeyJ' || event.code === 'Tab') {
      // Gesty klawisza: przy otwarciu oddajemy kursor notatnikowi, przy
      // zamknięciu od razu przejmujemy go z powrotem (brak cooldownu Esc).
      if (!gameJournal.hidden) requestPointerLock(true);
      else releasePointerLock();
    }
    if (event.code === 'BracketLeft' || event.code === 'BracketRight') {
      applyLookSensitivity(lookSensitivity + (event.code === 'BracketRight' ? 0.1 : -0.1), true);
    }
    return;
  }
  if (!lobby.classList.contains('is-active')) return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.key === 'Escape') {
    if (pointerLocked() || performance.now() - lastPointerUnlock < UNLOCK_GRACE_MS) {
      releasePointerLock();
      syncPointerHint();
      return;
    }
    goHome();
    return;
  }
  if (event.code === 'KeyV') {
    event.preventDefault();
    toggleLobbyView();
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
  // Lobby domyślnie jest first-person, ale wybór użytkownika pamiętamy.
  let lobbyFp = true;
  try { lobbyFp = localStorage.getItem(LOBBY_VIEW_KEY) !== 'orbit'; } catch { /* tryb prywatny */ }
  world.setFirstPerson(lobbyFp);
  syncLobbyViewButton();
  syncLobbyPointerUI();
  // Na dotyku palec pokonuje krótszą drogę niż mysz — v0.4 dawała tam 1.15×.
  const defaultLook = mouseCapable ? 1 : 1.15;
  try { applyLookSensitivity(Number(localStorage.getItem(LOOK_KEY)) || defaultLook); }
  catch { applyLookSensitivity(defaultLook); }
  try { applyHandResponsiveness(Number(localStorage.getItem(HAND_KEY)) || handResponsiveness()); }
  catch { applyHandResponsiveness(1); }
  syncQualityLabel();
  // Auto może zmienić profil w trakcie gry — odświeżamy etykietę raz na sekundę.
  window.setInterval(syncQualityLabel, 1000);
  online.onStatus = (status) => {
    onlineStatus = status;
    renderPlayerList();
    if (status === 'offline' && chatSeeded) {
      addChatMessage('RejPlay', 'Połączenie z bazą niedostępne — rozgrywka trwa bez czatu i Presence.');
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
  online.onParty = (state) => renderParty(state);
  online.onWave = ({ name, clientId }) => {
    world.remoteWave(clientId);
    showToast(lobbyToast, `${name} macha do Ciebie`);
  };
  online.onPartyStart = (by) => {
    showToast(lobbyToast, `${by} rozpoczyna dochodzenie razem z Tobą.`);
    if (lobby.classList.contains('is-active')) openGame('lobby');
    else showToast(globalToast, `${by} wzywa Cię do drużyny — wejdź do Lobby.`);
  };
  try {
    pendingParty = pendingParty || localStorage.getItem('rejplay:pending-party')?.toUpperCase() || null;
    if (pendingParty) localStorage.setItem('rejplay:pending-party', pendingParty);
  } catch { /* jw. */ }
  renderAccount();
  renderParty(null);
  void online.connect();
  void account.refresh();
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
    lobbyCrosshair.classList.toggle('is-aimed', world.crosshairOnPortal);
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
  renderRecent();
  renderSwatches();
  renderPlayerList();
  renderEditor();
  renderTutorial();
  renderLive();
  renderAssetCatalog();
  wireAssetModal();
  wireHubNav();
  applyTheme(state.theme);
  world.mount(heroStage, 'home');

  if (touchCapable) enableTouchControls();

  if (!assets) {
    showToast(globalToast, 'Nie udało się wczytać modeli postaci — używam neutralnego podglądu zastępczego.');
  }

  bootOverlay.classList.add('is-done');
}

void boot();
