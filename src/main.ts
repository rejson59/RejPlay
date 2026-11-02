import './style.css';
import { BOTS, GAMES, PALETTE, type GameInfo } from './games';
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

const state = {
  nick: readStored('rejplay:nick') || `Kulka_${Math.floor(10 + Math.random() * 90)}`,
  color: readStored('rejplay:color') || PALETTE[0].value,
};
if (!PALETTE.some((entry) => entry.value === state.color)) state.color = PALETTE[0].value;

const home = $('#home');
const lobby = $('#lobby');
const heroStage = $('#hero-stage');
const lobbyStage = $('#lobby-stage');
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
const touchControls = $('#touch-controls');
const joystick = $('#joystick');
const joystickKnob = $('#joystick-knob');
const jumpButton = $<HTMLButtonElement>('#jump-btn');

const world = new World({ color: state.color, name: state.nick });

// --------------------------------------------------------------------- toasts

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

function renderGames(): void {
  gameGrid.innerHTML = GAMES.map(
    (game) => `
      <article class="game-card" style="--card-a:${game.color};--card-b:${game.accent}">
        <div class="game-card__art" aria-hidden="true">
          <span class="art__orb art__orb--big"></span>
          <span class="art__orb art__orb--mid"></span>
          <span class="art__orb art__orb--small"></span>
        </div>
        <div class="game-card__body">
          <div class="game-card__meta">
            <span class="tag">${escapeHtml(game.tag)}</span>
            ${
              game.ready
                ? '<span class="live"><span class="dot"></span> Działa</span>'
                : '<span class="soon">Wkrótce</span>'
            }
          </div>
          <h3>${escapeHtml(game.title)}</h3>
          <p>${escapeHtml(game.description)}</p>
          <div class="game-card__foot">
            <span class="game-card__players">◉ ${escapeHtml(game.players)}</span>
            <button
              type="button"
              class="btn btn--sm ${game.ready ? 'btn--primary' : 'btn--ghost'}"
              data-game="${game.id}"
            >
              ${game.ready ? 'Graj teraz' : 'Zobacz'}
            </button>
          </div>
        </div>
      </article>`,
  ).join('');
}

function renderSwatches(): void {
  swatches.innerHTML = PALETTE.map(
    (entry) => `
      <button
        type="button"
        class="swatch"
        data-color="${entry.value}"
        style="--swatch:${entry.value}"
        aria-label="Kolor: ${entry.name}"
        title="${entry.name}"
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
  addChatMessage('Bąbel', 'siema! świetna kulka :)', '#42e8b4');
  addChatMessage('Sferka', 'kto biega do fioletowego portalu?', '#ff8fd0');
  addChatMessage('RejPlay', 'To demo czatu — wiadomości zostają w Twojej karcie.');
}

function enterLobby(): void {
  if (lobby.classList.contains('is-active')) return;
  lobby.classList.add('is-active');
  lobby.setAttribute('aria-hidden', 'false');
  home.setAttribute('aria-hidden', 'true');
  document.body.classList.add('in-lobby');
  document.title = 'Plaza Kulki · RejPlay';
  world.mount(lobbyStage, 'lobby');
  renderPlayerList();
  seedChat();
  showToast(lobbyToast, 'Plaza Kulki · WASD = ruch, spacja = skok, przeciągnij = kamera');
}

function goHome(): void {
  if (!lobby.classList.contains('is-active')) return;
  lobby.classList.remove('is-active');
  lobby.setAttribute('aria-hidden', 'true');
  home.setAttribute('aria-hidden', 'false');
  document.body.classList.remove('in-lobby');
  document.title = 'RejPlay — Twoje mini gierki w przeglądarce';
  chatInput.blur();
  world.mount(heroStage, 'home');
}

// ------------------------------------------------------------------- listeners

document.addEventListener('click', (event) => {
  const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!action) return;
  if (action.dataset.action === 'enter-lobby') enterLobby();
  if (action.dataset.action === 'open-info') {
    $('#avatar').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

gameGrid.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-game]');
  if (!button) return;
  const game: GameInfo | undefined = GAMES.find((entry) => entry.id === button.dataset.game);
  if (!game) return;
  if (game.ready) {
    enterLobby();
  } else {
    showToast(
      globalToast,
      `„${game.title}” jest jeszcze w przygotowaniu. Na razie zapraszamy na Plaza Kulki 🙌`,
    );
  }
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

world.onPortalSelect((id) => {
  const game = GAMES.find((entry) => entry.id === id);
  showToast(
    lobbyToast,
    game
      ? `Portal „${game.title}” — ta gierka powstaje. Plaza Kulki działa już teraz!`
      : 'Portal',
  );
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && lobby.classList.contains('is-active')) goHome();
});

// Sterowanie dotykowe
if (window.matchMedia('(pointer: coarse)').matches) {
  touchControls.hidden = false;
  let active = false;

  const updateStick = (event: PointerEvent): void => {
    const rect = joystick.getBoundingClientRect();
    let dx = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    let dy = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
    const length = Math.hypot(dx, dy);
    if (length > 1) {
      dx /= length;
      dy /= length;
    }
    joystickKnob.style.transform = `translate(calc(-50% + ${dx * rect.width * 0.3}px), calc(-50% + ${dy * rect.height * 0.3}px))`;
    world.setJoystick(dx, -dy);
  };

  const resetStick = (): void => {
    active = false;
    joystickKnob.style.transform = 'translate(-50%, -50%)';
    world.setJoystick(0, 0);
  };

  joystick.addEventListener('pointerdown', (event) => {
    active = true;
    joystick.setPointerCapture(event.pointerId);
    updateStick(event);
  });
  joystick.addEventListener('pointermove', (event) => {
    if (active) updateStick(event);
  });
  joystick.addEventListener('pointerup', resetStick);
  joystick.addEventListener('pointercancel', resetStick);
  jumpButton.addEventListener('click', () => world.jump());
}

// ------------------------------------------------------------------ inicjalizacja

nickInput.value = state.nick;
renderGames();
renderSwatches();
renderPlayerList();
world.mount(heroStage, 'home');
