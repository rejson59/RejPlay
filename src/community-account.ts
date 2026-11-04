/**
 * Wspólne konto z główną stroną rejson59.github.io.
 *
 * RejPlay NIE ma własnej bazy użytkowników, haseł ani rejestracji. Używamy
 * dokładnie tej samej sesji `rejson_community_session_v1`, którą zapisuje
 * /logowanie na głównym originie. RejPlay działa pod /RejPlay/ na TYM SAMYM
 * originie, więc localStorage jest współdzielone — logowanie i rejestracja
 * odbywają się w jednym miejscu, jednym kontem, jednym hasłem.
 *
 * Token jest walidowany przez RPC community_whoami (a drużyny dodatkowo
 * po stronie serwera przez community_session_user). Nigdy nie trafia do URL,
 * czatu, presence ani postMessage.
 */

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
    this.pending = (async () => {
      const stored = this.stored();
      if (!stored) {
        this.publish(null);
        return null;
      }
      try {
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
          if (typeof data?.username === 'string' && data.username) {
            session = { username: data.username, token: stored.token };
          }
        }
        // Sesja mogła się zmienić w trakcie zapytania.
        if (this.stored()?.token !== stored.token) session = null;
        this.publish(session);
        return session;
      } catch {
        this.publish(null);
        return null;
      } finally {
        this.pending = null;
      }
    })();
    return this.pending;
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
