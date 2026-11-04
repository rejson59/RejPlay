import { COMMUNITY_ANON_KEY, type CommunityAccount, type CommunitySession } from './community-account';
import { SUPABASE_URL } from './online';
import { DialogFocus } from './dialog';

/**
 * Brama konta RejPlay (v0.7). Bez zalogowania lub rejestracji nie można
 * wejść do Lobby ani rozpocząć gry — sprawdza to `require()` wołane na
 * początku `enterLobby()` i `openGame()`, więc żaden skrót ani portal 3D
 * nie obejdzie blokady.
 *
 * RejPlay nie ma własnej bazy haseł. Używamy tych samych RPC i tego samego
 * klucza sesji co /logowanie na rejson59.github.io:
 *   community_login / community_register (p_username, p_pin)
 *   community_whoami (p_token)
 *   localStorage['rejson_community_session_v1'] = { token, username }
 * Dzięki temu jedno konto działa na całej stronie, a formularz działa też
 * w dev na localhost (gdzie nie ma współdzielonego localStorage).
 * Token nigdy nie trafia do URL, czatu, presence ani logów.
 */

const SESSION_KEY = 'rejson_community_session_v1';
const API = SUPABASE_URL.replace(/\/$/, '');

export type AuthAction = 'lobby' | 'game';

interface AuthGateOptions {
  account: CommunityAccount;
  /** Wznawiane po udanym logowaniu, jeśli bramę otworzyła akcja gry/lobby. */
  onResume: (action: AuthAction) => void;
  /** Zamyka inne okna modalne, żeby brama zawsze była na wierzchu. */
  onOpen?: () => void;
}

async function rpc<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${API}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      apikey: COMMUNITY_ANON_KEY,
      Authorization: `Bearer ${COMMUNITY_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null) as { message?: string } | null;
  if (!response.ok) throw new Error(data?.message ?? 'Nie udało się połączyć z kontem. Spróbuj ponownie.');
  return data as T;
}

export class AuthGate {
  private readonly root: HTMLElement;
  private readonly form: HTMLFormElement;
  private readonly nameInput: HTMLInputElement;
  private readonly secretInput: HTMLInputElement;
  private readonly secretLabel: HTMLElement;
  private readonly submit: HTMLButtonElement;
  private readonly error: HTMLElement;
  private readonly signedPanel: HTMLElement;
  private readonly signedName: HTMLElement;
  private readonly loginTab: HTMLButtonElement;
  private readonly registerTab: HTMLButtonElement;
  private readonly logoutButton: HTMLButtonElement | null;
  private readonly account: CommunityAccount;
  private readonly onResume: AuthGateOptions['onResume'];
  private readonly onOpen: AuthGateOptions['onOpen'];
  private readonly focus: DialogFocus;
  private mode: 'login' | 'register' = 'login';
  private pending: AuthAction | null = null;
  private busy = false;

  constructor(options: AuthGateOptions) {
    this.account = options.account;
    this.onResume = options.onResume;
    this.onOpen = options.onOpen;
    this.root = document.querySelector<HTMLElement>('#auth')!;
    this.form = document.querySelector<HTMLFormElement>('#auth-form')!;
    this.nameInput = document.querySelector<HTMLInputElement>('#auth-name')!;
    this.secretInput = document.querySelector<HTMLInputElement>('#auth-secret')!;
    this.secretLabel = document.querySelector<HTMLElement>('#auth-secret-label')!;
    this.submit = document.querySelector<HTMLButtonElement>('#auth-submit')!;
    this.error = document.querySelector<HTMLElement>('#auth-error')!;
    this.signedPanel = document.querySelector<HTMLElement>('#auth-signed')!;
    this.signedName = document.querySelector<HTMLElement>('#auth-signed-name')!;
    this.loginTab = document.querySelector<HTMLButtonElement>('#auth-tab-login')!;
    this.registerTab = document.querySelector<HTMLButtonElement>('#auth-tab-register')!;
    this.logoutButton = document.querySelector<HTMLButtonElement>('#auth-logout');
    this.focus = new DialogFocus(this.root, () => this.isOpen);

    this.loginTab.addEventListener('click', () => this.setMode('login'));
    this.registerTab.addEventListener('click', () => this.setMode('register'));
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.submitForm();
    });
    this.root.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('[data-auth-close]')) this.close();
    });
    this.logoutButton?.addEventListener('click', () => {
      this.account.logout();
      this.close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.isOpen && !this.busy) this.close();
    });
  }

  get isOpen(): boolean {
    return this.root.classList.contains('is-active');
  }

  /** Jedyny punkt decyzji: zalogowany → gra, niezalogowany → ekran konta. */
  require(action: AuthAction): boolean {
    if (this.account.session) return true;
    this.open(action);
    return false;
  }

  /**
   * `action` jest jawny: podgląd konta (null) nie może odziedziczyć
   * niedokończonej akcji z wcześniej otwartej bramy.
   */
  open(action: AuthAction | null = null): void {
    this.pending = action;
    this.onOpen?.();
    this.focus.capture();
    this.root.classList.add('is-active');
    this.root.setAttribute('aria-hidden', 'false');
    this.setMode(this.mode);
    this.render(this.account.session);
    window.setTimeout(() => {
      // Opóźniony fokus nie może odebrać go polu oznaczonemu błędem ani
      // wskoczyć w already zamknięte okno.
      if (!this.isOpen || this.busy || !this.error.hidden) return;
      (this.account.session ? this.logoutButton : this.nameInput)?.focus();
    }, 40);
  }

  close(): void {
    if (this.busy) return;
    this.root.classList.remove('is-active');
    this.root.setAttribute('aria-hidden', 'true');
    this.pending = null;
    this.error.hidden = true;
    this.focus.restore();
  }

  /** Odświeża widok zalogowanego konta (używane przez renderAccount). */
  render(session: CommunitySession | null): void {
    const signed = Boolean(session);
    this.signedPanel.hidden = !signed;
    this.form.hidden = signed;
    this.loginTab.hidden = signed;
    this.registerTab.hidden = signed;
    if (signed) this.signedName.textContent = session!.username;
  }

  private setMode(mode: 'login' | 'register'): void {
    this.mode = mode;
    const login = mode === 'login';
    this.loginTab.classList.toggle('is-active', login);
    this.registerTab.classList.toggle('is-active', !login);
    this.loginTab.setAttribute('aria-pressed', String(login));
    this.registerTab.setAttribute('aria-pressed', String(!login));
    this.submit.textContent = login ? 'Zaloguj się i graj' : 'Utwórz konto i graj';
    this.secretLabel.textContent = login ? 'Hasło lub PIN' : 'Nowe hasło (min. 10 znaków)';
    this.secretInput.autocomplete = login ? 'current-password' : 'new-password';
    this.secretInput.placeholder = login ? 'Twoje hasło' : 'Co najmniej 10 znaków';
    this.error.hidden = true;
  }

  private report(message: string): void {
    this.error.textContent = message;
    this.error.hidden = !message;
  }

  private async submitForm(): Promise<void> {
    if (this.busy) return;
    const username = this.nameInput.value.trim();
    const secret = this.secretInput.value;
    const bytes = new TextEncoder().encode(secret).length;
    const chars = Array.from(secret).length;
    this.nameInput.removeAttribute('aria-invalid');
    this.secretInput.removeAttribute('aria-invalid');
    const reject = (message: string, field: HTMLInputElement): void => {
      this.report(message);
      field.setAttribute('aria-invalid', 'true');
      field.focus();
    };
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,23}$/.test(username)) {
      reject('Nazwa konta: 3–24 znaki, tylko litery, cyfry oraz kropka, podkreślenie i myślnik.', this.nameInput);
      return;
    }
    if (bytes > 72) {
      reject('Hasło jest zbyt długie — maksymalnie 72 bajty.', this.secretInput);
      return;
    }
    if (this.mode === 'register' && chars < 10) {
      reject('Nowe hasło musi mieć co najmniej 10 znaków.', this.secretInput);
      return;
    }
    if (chars === 0) {
      reject('Podaj hasło lub PIN.', this.secretInput);
      return;
    }
    this.busy = true;
    this.submit.disabled = true;
    this.form.setAttribute('aria-busy', 'true');
    this.report('');
    try {
      const fn = this.mode === 'login' ? 'community_login' : 'community_register';
      const data = await rpc<{ token?: string; username?: string; error?: string }>(fn, {
        p_username: username,
        p_pin: secret,
      });
      if (typeof data?.token !== 'string' || data.token.length < 16 || typeof data.username !== 'string' || !data.username) {
        throw new Error(data?.error ?? 'Nieprawidłowa odpowiedź serwera. Spróbuj ponownie.');
      }
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify({ token: data.token, username: data.username }));
      } catch {
        throw new Error('Nie można zapisać sesji w tej przeglądarce. Włącz pamięć lokalną i spróbuj ponownie.');
      }
      const session = await this.account.refresh();
      if (!session) throw new Error('Nie udało się potwierdzić sesji. Zaloguj się ponownie.');
      this.secretInput.value = '';
      this.render(session);
      window.dispatchEvent(new Event('rj:session-change'));
      const action = this.pending;
      this.busy = false; // close() jest zablokowane w trakcie wysyłania
      this.close();
      if (action) this.onResume(action);
    } catch (err) {
      this.report(err instanceof Error ? err.message : 'Nie udało się zalogować.');
    } finally {
      this.busy = false;
      this.submit.disabled = false;
      this.form.removeAttribute('aria-busy');
    }
  }
}
