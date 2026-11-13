import { el, toast, clear } from './dom';
import type { GameMeta, AudioEngineLike } from './types';

/** Wspólna ramka każdej gry: pasek, status, toasty, panel zasad, sprzątanie. */
export class Shell {
  readonly node: HTMLElement;
  readonly body: HTMLElement;
  readonly status: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly help: HTMLElement;
  private readonly cleanups: (() => void)[] = [];
  private readonly audio: AudioEngineLike;

  constructor(host: HTMLElement, meta: GameMeta, audio: AudioEngineLike, onExit: () => void) {
    this.audio = audio;
    this.status = el('span', { class: 'game-bar__status', text: '' });
    this.toasts = el('div', { class: 'game-toasts' });
    this.help = el('div', { class: 'help-overlay', hidden: true });
    this.body = el('div', { class: 'game-body' });

    const back = el('button', { type: 'button', class: 'game-bar__back', text: '← Gabinet' });
    back.addEventListener('click', () => { this.audio.play('ui'); onExit(); });
    const mute = el('button', {
      type: 'button', class: 'game-bar__icon',
      'aria-label': 'Wycisz dźwięk', text: audio.muted ? '🔇' : '🔊',
    });
    mute.addEventListener('click', () => {
      audio.setMuted(!audio.muted);
      mute.textContent = audio.muted ? '🔇' : '🔊';
      if (!audio.muted) audio.play('ui');
    });
    const helpBtn = el('button', { type: 'button', class: 'game-bar__icon', 'aria-label': 'Jak grać', text: '?' });
    helpBtn.addEventListener('click', () => this.toggleHelp());

    const bar = el('header', { class: 'game-bar' },
      back,
      el('div', { class: 'game-bar__title' },
        el('b', { text: `${meta.number}. ${meta.title}` }),
        el('small', { text: meta.subtitle })),
      el('div', { class: 'game-bar__right' }, this.status, mute, helpBtn));

    this.node = el('div', { class: `game-shell game-shell--${meta.id}` },
      bar, this.body, this.toasts, this.help);
    clear(host);
    host.append(this.node);
  }

  setStatus(text: string): void { this.status.textContent = text; }
  toast(message: string, kind: 'info' | 'good' | 'bad' = 'info'): void { toast(this.toasts, message, kind); }

  showHelp(title: string, lines: string[]): void {
    clear(this.help);
    const panel = el('div', { class: 'help-panel' },
      el('h2', { text: title }),
      el('ul', {}, ...lines.map((line) => el('li', { text: line }))),
      el('button', { type: 'button', class: 'btn', text: 'Zamknij', onclick: () => this.toggleHelp() }));
    this.help.append(panel);
    this.help.hidden = false;
  }

  private toggleHelp(): void {
    this.help.hidden = !this.help.hidden;
    this.audio.play('ui');
  }

  /** Gry rejestrują tu rAF, intervale i listenery dokumentu. */
  onCleanup(fn: () => void): void { this.cleanups.push(fn); }

  dispose(): void {
    for (const fn of this.cleanups) { try { fn(); } catch { /* ignoruj */ } }
    this.cleanups.length = 0;
    this.node.remove();
  }
}
