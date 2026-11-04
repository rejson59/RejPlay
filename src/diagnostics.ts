/**
 * Jeden, bezpieczny bufor logów do wklejenia w czacie.
 *
 * Użytkownik zgłosił błąd z kamerki i poprosił o przycisk „kopiuj logi”.
 * Zamiast prosić o przepisywanie konsoli zbieramy tu:
 *  - własne zdarzenia modułów (kamerka, Hands, FaceMesh, sterowanie),
 *  - ostrzeżenia i błędy z konsoli,
 *  - nieobsłużone wyjątki i odrzucone promisy,
 *  - fakty o środowisku i strumieniu wideo.
 *
 * Raport NIE zawiera nazw kont, tokenów, kodów drużyny ani treści czatu.
 * Wartości wyglądające na sekrety są wycinane już przy zapisie. Nic nie jest
 * nigdzie wysyłane — tekst powstaje dopiero po naciśnięciu przycisku i trafia
 * wyłącznie do schowka użytkownika.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  at: number;
  level: LogLevel;
  source: string;
  message: string;
}

const MAX_ENTRIES = 260;

/** Wycinamy wartości, które mogłyby wyciec z adresu lub komunikatu biblioteki. */
function redact(text: string): string {
  return text
    .replace(/\b(sb_(?:publishable|secret|anon)_[A-Za-z0-9_-]+)/gi, 'sb_[ukryte]')
    .replace(/((?:token|apikey|api_key|password|secret|pin|authorization|bearer)\s*[=:]\s*)([^\s&,;)"']+)/gi, '$1[ukryte]')
    .replace(/\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g, '[jwt-ukryty]')
    .slice(0, 500);
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'undefined') return 'undefined';
  try {
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  } catch {
    return String(value);
  }
}

class DiagnosticLog {
  private entries: LogEntry[] = [];
  private facts: Record<string, unknown> = {};
  private readonly started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  private installed = false;

  /** Montujemy przechwytywanie raz, przy starcie aplikacji. */
  install(): void {
    if (this.installed || typeof window === 'undefined') return;
    this.installed = true;

    for (const level of ['warn', 'error'] as const) {
      const original = console[level].bind(console);
      console[level] = (...args: unknown[]): void => {
        this.push(level, 'console', args.map(stringify).join(' '));
        original(...args);
      };
    }
    window.addEventListener('error', (event) => {
      const where = event.filename ? ` @ ${event.filename.split('/').pop()}:${event.lineno}` : '';
      this.push('error', 'window', `${stringify(event.message)}${where}`);
    });
    window.addEventListener('unhandledrejection', (event) => {
      this.push('error', 'promise', stringify(event.reason));
    });
    this.push('info', 'diagnostics', 'Bufor logów uruchomiony.');
  }

  push(level: LogLevel, source: string, message: unknown): void {
    const at = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.entries.push({ at, level, source, message: redact(stringify(message)) });
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
  }

  /** Fakty zastępowane przy każdym starcie kamerki (np. rozdzielczość). */
  setFact(key: string, value: unknown): void {
    this.facts[key] = value;
  }

  clearFacts(): void {
    this.facts = {};
  }

  get count(): number {
    return this.entries.length;
  }

  get errorCount(): number {
    return this.entries.filter((entry) => entry.level === 'error').length;
  }

  /** Zwięzły, ale kompletny tekst do wklejenia w czacie. */
  report(): string {
    const now = new Date();
    const lines: string[] = [
      '=== RejPlay · raport z kamerki ===',
      `Data: ${now.toISOString()}`,
      `Wersja: v0.7.1`,
      `Adres: ${typeof location !== 'undefined' ? location.origin + location.pathname : 'n/a'} (bez parametrów)`,
      `Przeglądarka: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a'}`,
      `Ekran: ${typeof screen !== 'undefined' ? `${screen.width}x${screen.height}` : 'n/a'} · okno ${typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : 'n/a'}`,
      `Bezpieczne połączenie: ${typeof isSecureContext !== 'undefined' ? isSecureContext : 'n/a'} · mediaDevices: ${typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia}`,
      '',
      '--- Stan modułów ---',
    ];
    for (const [key, value] of Object.entries(this.facts)) {
      lines.push(`${key}: ${redact(stringify(value))}`);
    }
    lines.push('', '--- Ostatnie zdarzenia (czas od startu · poziom · źródło) ---');
    const tail = this.entries.slice(-110);
    if (!tail.length) lines.push('(brak)');
    for (const entry of tail) {
      const t = ((entry.at - this.started) / 1000).toFixed(2).padStart(8, ' ');
      lines.push(`[${t}s] ${entry.level.toUpperCase().padEnd(5)} ${entry.source.padEnd(14)} ${entry.message}`);
    }
    lines.push('', '=== koniec raportu · bez danych konta i bez obrazu z kamery ===');
    return lines.join('\n');
  }
}

export const diagnostics = new DiagnosticLog();

/** Kopiowanie z bezpiecznym fallbackiem, gdy przeglądarka blokuje schowek. */
export async function copyDiagnosticReport(): Promise<'copied' | 'fallback'> {
  const text = diagnostics.report();
  try {
    if (!navigator.clipboard?.writeText) throw new Error('brak Clipboard API');
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'fallback';
  }
}
