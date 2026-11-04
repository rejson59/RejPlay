/**
 * Wspólne konto z główną stroną rejson59.github.io.
 *
 * RejPlay NIE ma własnej bazy użytkowników. Lokalny ekran logowania i
 * rejestracji (`AuthGate`) oraz /logowanie na głównym originie używają tych
 * samych RPC i tej samej sesji `rejson_community_session_v1`. Na
 * rejson59.github.io localStorage jest współdzielone, więc jedno konto działa
 * w obu miejscach; na localhost formularz działa samodzielnie.
 *
 * Token jest walidowany przez RPC community_whoami (a drużyny dodatkowo
 * po stronie serwera przez community_session_user). Nigdy nie trafia do URL,
 * czatu, presence ani postMessage.
 */

/**
 * Publiczny klucz `anon` projektu rejson-widgets — dokładnie ten sam, którego
 * używa /js/logowanie.js. Nie jest sekretem: leży w publicznym JS głównej
 * strony i mapuje na rolę `anon`. Używamy go wyłącznie do RPC community_*,
 * żeby formularz RejPlay był identyczny ze sprawdzonym formularzem konta.
 */
export const COMMUNITY_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6YnF6ZmltdHJvaXhubGR6amVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1OTYzOTEsImV4cCI6MjEwODE3MjM5MX0.oeZWOaNd6p3wZBZQQu3QWjRHlrkxV_BFQRNSN-6YntE';

const SESSION_KEY = 'rejson_community_session_v1';
const RETURN_KEY = 'rejson_account_return_v1';
const LOGIN_PATH = '/logowanie?powrot=1';

interface RejsonAccountBridge {
  getSession(): Promise<{ username: string; token: string } | null>;
  open(): void;
  subscribe(fn: () => void): () => void;
}

declare global {
  interface Window {
    RejsonAccount?: RejsonAccountBridge;
  }
}

export interface CommunitySession {
  username: string;
  token: string;
}

export interface CommunityAccountOptions {
  /** URL i klucz publiczny Supabase (współdzielone z warstwą online). */
  url: string;
  key: string;
  onSession?: (session: CommunitySession | null) => void;
}

export class CommunityAccount {
  session: CommunitySession | null = null;
  /** true, gdy bieżący origin może współdzielić localStorage z główną stroną. */
  readonly sharedOrigin: boolean;

  private readonly url: string;
  private readonly key: string;
  private readonly onSession: CommunityAccountOptions['onSession'];
  private pending: Promise<CommunitySession | null> | null = null;

  constructor(options: CommunityAccountOptions) {
    this.url = options.url.replace(/\/$/, '');
    this.key = options.key;
    this.onSession = options.onSession;
    this.sharedOrigin = location.hostname === 'rejson59.github.io';
    window.addEventListener('storage', (event) => {
      if (event.key === SESSION_KEY || event.key === null) void this.refresh();
    });
    window.addEventListener('rj:session-change', () => void this.refresh());
    window.addEventListener('rj:account-ready', () => void this.refresh());
  }

  private stored(): { token: string; username?: string } | null {
    try {
      const raw = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
      if (raw && typeof raw.token === 'string' && raw.token.length >= 16) return raw;
    } catch {
      /* prywatny tryb / uszkodzony zapis */
    }
    return null;
  }

  private publish(session: CommunitySession | null): void {
    this.session = session;
    this.onSession?.(session);
  }

  async refresh(): Promise<CommunitySession | null> {
    if (this.pending) return this.pending;
    const task = (async (): Promise<CommunitySession | null> => {
      try {
        const stored = this.stored();
        if (!stored) {
          this.publish(null);
          return null;
        }
        let session: CommunitySession | null = null;
        if (window.RejsonAccount) {
          session = await window.RejsonAccount.getSession();
        } else {
          const response = await fetch(`${this.url}/rest/v1/rpc/community_whoami`, {
            method: 'POST',
            cache: 'no-store',
            headers: {
              apikey: this.key,
              Authorization: `Bearer ${this.key}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ p_token: stored.token }),
          });
          if (!response.ok) throw new Error('Nie można potwierdzić konta.');
          const data = (await response.json()) as { username?: string | null };
          if (data?.username === null) {
            // Serwer mówi wprost, że token wygasł — nie zostawiamy go na kolejne starty.
            try { localStorage.removeItem(SESSION_KEY); } catch { /* brak storage */ }
          }
          if (typeof data?.username === 'string' && data.username) {
            session = { username: data.username, token: stored.token };
          }
        }
        // Sesja mogła się zmienić w trakcie zapytania.
        if (this.stored()?.token !== stored.token) session = null;
        this.publish(session);
        return session;
      } catch {
        // Nawet awaria callbacku UI nie może zostawić `refresh()` odrzuconego.
        try { this.publish(null); } catch { /* ignorujemy błąd konsumenta */ }
        return null;
      }
    })();
    this.pending = task;
    // Czyszczenie MUSI być mikrotaskiem PO przypisaniu i obejmować też
    // odrzucenie. Wewnętrzny `finally` w synchronicznej ścieżce „brak sesji"
    // wykonywał się przed przypisaniem i zostawiał resolved promise na
    // zawsze — wtedy logowanie nie mogło już zwalidować tokenu.
    const clear = (): void => {
      if (this.pending === task) this.pending = null;
    };
    void task.then(clear, clear);
    return task;
  }

  /** Przekierowanie do /logowanie (logowanie I rejestracja są tam, nie tutaj). */
  open(): void {
    if (!this.sharedOrigin) return;
    if (window.RejsonAccount) {
      window.RejsonAccount.open();
      return;
    }
    try {
      sessionStorage.setItem(
        RETURN_KEY,
        JSON.stringify({ path: location.pathname + location.search + location.hash, at: Date.now() }),
      );
    } catch {
      /* powrót jest opcjonalny */
    }
    location.assign(LOGIN_PATH);
  }

  logout(): void {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* jw. */
    }
    this.publish(null);
    window.dispatchEvent(new Event('rj:session-change'));
  }

  get loginUrl(): string {
    return LOGIN_PATH;
  }
}
