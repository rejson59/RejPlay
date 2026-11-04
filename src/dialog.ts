/**
 * Wspólna obsługa okien dialogowych (`role="dialog" aria-modal="true"`).
 *
 * Przywraca fokus do elementu, który otworzył okno, i zamyka Tab w obrębie
 * dialogu — bez tego klawiatura ucieka do treści zasłoniętej backdropem.
 * Używana przez bramę konta i katalog assetów, żeby oba okna zachowywały się
 * identycznie.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export class DialogFocus {
  private previous: HTMLElement | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly isOpen: () => boolean,
  ) {
    document.addEventListener('keydown', (event) => this.onKeyDown(event));
  }

  /** Wywołać przed pokazaniem okna — zapamiętuje element wywołujący. */
  capture(): void {
    const active = document.activeElement;
    this.previous = active instanceof HTMLElement && !this.root.contains(active) ? active : null;
  }

  /** Wywołać po zamknięciu okna — zwraca fokus, jeśli element wciąż istnieje. */
  restore(): void {
    if (this.previous?.isConnected) this.previous.focus({ preventScroll: true });
    this.previous = null;
  }

  private focusable(): HTMLElement[] {
    return Array.from(this.root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (element) => !element.hidden && element.getClientRects().length > 0,
    );
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || !this.isOpen() || event.altKey || event.ctrlKey || event.metaKey) return;
    const items = this.focusable();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const inside = active instanceof Node && this.root.contains(active);
    if (event.shiftKey && (!inside || active === first)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (!inside || active === last)) {
      event.preventDefault();
      first.focus();
    }
  }
}
