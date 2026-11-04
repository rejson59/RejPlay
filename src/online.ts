import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { Appearance } from './character';
import type { CommunitySession } from './community-account';

/**
 * Warstwa sieciowa RejPlay → Supabase `rejson-widgets`.
 *
 * Używamy WYŁĄCZNIE klucza publishable/anon (bezpiecznego dla przeglądarki).
 * Klucz service_role i sekrety nigdy nie trafiają do frontendu.
 *
 * Multiplayer = Realtime Presence (pozycje, wygląd, ruch) + Realtime
 * postgres_changes na czacie + broadcast „start razem”. Drużyny (party)
 * zawężają kanał Presence i czat tylko do osób z tym samym kodem, a token
 * konta z rejson59.github.io jest walidowany w bazie (SECURITY DEFINER RPC).
 * Jeśli sieć/Supabase jest niedostępne, gra działa w pełni lokalnie.
 */

export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://hzbqzfimtroixnldzjeq.supabase.co';
export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  'sb_publishable_PeNxhJkouoKnAyFFmqXDdg_XbS_XtcX';

const URL = SUPABASE_URL;
const KEY = SUPABASE_ANON_KEY;

export type OnlineMode = 'home' | 'lobby' | 'game';
export type OnlineStatus = 'connecting' | 'online' | 'offline';

export interface OnlinePeer {
  id: string;
  nick: string;
  color: string;
  appearance: Appearance;
  x: number;
  y: number;
  z: number;
  yaw: number;
  mode: OnlineMode;
  /** Identyfikator konta głównej strony, jeśli gracz jest zalogowany. */
  userId?: string;
  verified?: boolean;
}

export interface OnlineChatMessage {
  key: string;
  nick: string;
  color: string;
  content: string;
  at: number;
  own: boolean;
  offline?: boolean;
}

export interface LocalState {
  nick: string;
  color: string;
  appearance: Appearance;
  mode: OnlineMode;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface PartyMember {
  clientId: string;
  nick: string;
  color: string;
  appearance: Appearance;
  userId: string;
}

export interface PartyState {
  code: string;
  name: string;
  leader: string;
  leaderNick: string;
  username: string;
  userId: string;
  members: PartyMember[];
}

export interface PartyResult extends Partial<PartyState> {
  ok: boolean;
  error?: string;
}

interface PresenceRow extends Partial<OnlinePeer> {
  id?: string;
}

function safeAppearance(value: unknown, fallback: Appearance): Appearance {
  if (!value || typeof value !== 'object') return fallback;
  const raw = value as Partial<Appearance>;
  return {
    model: Number.isFinite(raw.model) ? Math.max(0, Math.min(12, Math.floor(raw.model!))) : fallback.model,
    skin: typeof raw.skin === 'string' && /^#[0-9a-f]{6}$/i.test(raw.skin) ? raw.skin : fallback.skin,
    hair: typeof raw.hair === 'string' && /^#[0-9a-f]{6}$/i.test(raw.hair) ? raw.hair : fallback.hair,
    outfit: typeof raw.outfit === 'string' && raw.outfit.length < 40 ? raw.outfit : fallback.outfit,
  };
}

const randomCode = (): string => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
};

export class OnlineClient {
  readonly id: string;
  status: OnlineStatus = 'connecting';
  onPeers?: (peers: OnlinePeer[]) => void;
  onChat?: (message: OnlineChatMessage) => void;
  onStatus?: (status: OnlineStatus) => void;
  onParty?: (state: PartyState | null) => void;
  onPartyStart?: (by: string) => void;

  private client: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;
  private local: LocalState;
  private lastTrack = 0;
  private everOnline = false;
  private stopped = false;
  private readonly sent = new Map<string, number>();
  private peers: OnlinePeer[] = [];
  private accountToken: string | null = null;
  private accountUserId: string | null = null;
  partyCode: string | null = null;
  party: PartyState | null = null;
  private heartbeatTimer = 0;

  constructor(local: LocalState) {
    this.local = { ...local };
    let id = '';
    try {
      id = localStorage.getItem('rejplay:client-id') ?? '';
      if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem('rejplay:client-id', id);
      }
    } catch {
      id = `anon-${Math.random().toString(36).slice(2)}`;
    }
    this.id = id;
  }

  private setStatus(status: OnlineStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.onStatus?.(status);
  }

  /** Sesja współdzielona z główną stroną — tylko token, nigdy hasło. */
  setAccount(session: CommunitySession | null): void {
    this.accountToken = session?.token ?? null;
    this.accountUserId = null;
    if (!session && this.partyCode) void this.leaveParty();
  }

  async connect(): Promise<void> {
    if (!URL || !KEY) {
      this.setStatus('offline');
      return;
    }
    try {
      this.client = createClient(URL, KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        realtime: { params: { eventsPerSecond: 12 } },
      });
      this.joinChannel();
      // Brak połączenia nie może blokować gry w nieskończoność.
      window.setTimeout(() => {
        if (this.status === 'connecting') {
          this.setStatus('offline');
          if (!this.everOnline) this.stopRetrying();
        }
      }, 9000);
      void this.loadRecentChat();
    } catch {
      this.client = null;
      this.setStatus('offline');
    }
  }

  /** Jeden kanał: Atrium albo wyłącznie drużyna. */
  private joinChannel(): void {
    if (!this.client || this.stopped) return;
    if (this.channel) void this.client.removeChannel(this.channel);
    const name = this.partyCode ? `rejplay:party:${this.partyCode}` : 'rejplay:atrium';
    const channel = this.client.channel(name, {
      config: { presence: { key: this.id }, broadcast: { self: false } },
    });
    channel
      .on('presence', { event: 'sync' }, () => this.syncPeers())
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'rejplay_chat' },
        (payload) => this.receiveChat(payload.new as Record<string, unknown>),
      )
      .on('broadcast', { event: 'party_start' }, ({ payload }) => {
        this.onPartyStart?.(String((payload as { by?: string })?.by ?? 'Gracz'));
      });
    this.channel = channel;
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        this.everOnline = true;
        this.setStatus('online');
        void this.track(true);
        void this.saveProfile();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        this.setStatus('offline');
        if (!this.everOnline) this.stopRetrying();
      }
    });
  }

  private stopRetrying(): void {
    if (this.stopped) return;
    this.stopped = true;
    const channel = this.channel;
    this.channel = null;
    if (this.client && channel) void this.client.removeChannel(channel);
  }

  private syncPeers(): void {
    const channel = this.channel;
    if (!channel) return;
    const state = channel.presenceState<PresenceRow>();
    const peers: OnlinePeer[] = [];
    for (const [id, rows] of Object.entries(state)) {
      if (id === this.id) continue;
      const row = rows[rows.length - 1] as PresenceRow | undefined;
      if (!row) continue;
      peers.push({
        id,
        nick: String(row.nick ?? 'Gracz').slice(0, 24),
        color: /^#[0-9a-f]{6}$/i.test(String(row.color ?? '')) ? String(row.color) : '#c8a06a',
        appearance: safeAppearance(row.appearance, this.local.appearance),
        x: Number(row.x) || 0,
        y: Number(row.y) || 0,
        z: Number(row.z) || 0,
        yaw: Number(row.yaw) || 0,
        mode: (['home', 'lobby', 'game'] as const).includes(row.mode as OnlineMode)
          ? (row.mode as OnlineMode)
          : 'home',
        userId: typeof row.userId === 'string' ? row.userId : undefined,
        verified: Boolean(row.verified),
      });
    }
    this.peers = peers;
    this.onPeers?.(peers);
  }

  /** Pozycja / wygląd wysyłane najwyżej ~8 razy na sekundę. */
  update(patch: Partial<LocalState>): void {
    this.local = { ...this.local, ...patch };
    const now = performance.now();
    if (now - this.lastTrack < 120) return;
    this.lastTrack = now;
    void this.track(false);
  }

  private async track(force: boolean): Promise<void> {
    const channel = this.channel;
    if (!channel || (!force && this.status !== 'online')) return;
    try {
      await channel.track({
        ...this.local,
        id: this.id,
        userId: this.accountUserId ?? undefined,
        verified: Boolean(this.accountToken),
      });
    } catch {
      // Presence jest opcjonalny.
    }
  }

  private async saveProfile(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.from('rejplay_profiles').upsert({
        client_id: this.id,
        nick: this.local.nick,
        color: this.local.color,
        appearance: this.local.appearance,
        updated_at: new Date().toISOString(),
      });
    } catch {
      // Profil nie jest krytyczny.
    }
  }

  /** Zdarzenia produktowe (start gry, dowód, raport) trafiają do bazy. */
  event(kind: string, detail = ''): void {
    if (!this.client) return;
    void this.client
      .from('rejplay_events')
      .insert({ client_id: this.id, nick: this.local.nick, kind: kind.slice(0, 40), detail: detail.slice(0, 180) })
      .then(() => undefined, () => undefined);
  }

  // ------------------------------------------------------------------ drużyny

  private async rpc(fn: string, extra: Record<string, unknown> = {}): Promise<PartyResult> {
    if (!this.client) return { ok: false, error: 'Brak połączenia z Supabase — tryb offline.' };
    if (!this.accountToken) {
      return { ok: false, error: 'Zaloguj się kontem rejson59.github.io, aby grać w drużynie.' };
    }
    try {
      const { data, error } = await this.client.rpc(fn, {
        p_token: this.accountToken,
        p_client_id: this.id,
        p_nick: this.local.nick,
        p_color: this.local.color,
        p_appearance: this.local.appearance,
        ...extra,
      });
      if (error) return { ok: false, error: error.message };
      return (data ?? { ok: false }) as PartyResult;
    } catch (cause) {
      return { ok: false, error: cause instanceof Error ? cause.message : 'Błąd połączenia.' };
    }
  }

  private applyParty(result: PartyResult): PartyResult {
    if (!result.ok || !result.code) return result;
    const state: PartyState = {
      code: result.code,
      name: result.name ?? 'Drużyna',
      leader: result.leader ?? '',
      leaderNick: result.leaderNick ?? '',
      username: result.username ?? '',
      userId: result.userId ?? '',
      members: Array.isArray(result.members) ? result.members : [],
    };
    const changed = this.partyCode !== state.code;
    this.partyCode = state.code;
    this.party = state;
    this.accountUserId = state.userId || null;
    this.onParty?.(state);
    if (changed) {
      this.joinChannel();
      void this.loadRecentChat();
      this.startHeartbeat();
      try {
        const url = new URL(location.href);
        url.searchParams.set('party', state.code);
        history.replaceState(null, '', url.toString());
      } catch {
        /* prywatny tryb */
      }
    }
    void this.track(true);
    return result;
  }

  private startHeartbeat(): void {
    window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = window.setInterval(() => {
      if (!this.partyCode || !this.accountToken) return;
      void this.rpc('rejplay_party_heartbeat', { p_code: this.partyCode }).then((result) => {
        if (result.ok && result.code) this.applyParty(result);
        else if (result.error) this.onParty?.(null);
      });
    }, 20000);
  }

  async createParty(name: string, code = randomCode()): Promise<PartyResult> {
    const result = await this.rpc('rejplay_party_create', { p_code: code, p_name: name });
    return this.applyParty(result);
  }

  async joinParty(code: string): Promise<PartyResult> {
    const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    if (clean.length < 4) return { ok: false, error: 'Kod ma 4–10 znaków.' };
    const result = await this.rpc('rejplay_party_join', { p_code: clean });
    return this.applyParty(result);
  }

  async leaveParty(): Promise<void> {
    const code = this.partyCode;
    window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = 0;
    if (code) await this.rpc('rejplay_party_leave', { p_code: code });
    this.partyCode = null;
    this.party = null;
    this.accountUserId = null;
    this.onParty?.(null);
    this.joinChannel();
    void this.loadRecentChat();
    try {
      const url = new URL(location.href);
      url.searchParams.delete('party');
      history.replaceState(null, '', url.toString());
    } catch {
      /* jw. */
    }
  }

  /** „Rozpocznij razem”: broadcast do wszystkich w drużynie. */
  startPartyRound(): void {
    if (!this.partyCode || !this.channel) return;
    void this.channel.send({
      type: 'broadcast',
      event: 'party_start',
      payload: { by: this.local.nick, at: Date.now() },
    });
  }

  inviteUrl(code = this.partyCode): string {
    if (!code) return '';
    try {
      const url = new URL(location.pathname, location.origin);
      url.searchParams.set('party', code);
      return url.toString();
    } catch {
      return '';
    }
  }

  private async loadRecentChat(): Promise<void> {
    if (!this.client) return;
    try {
      let query = this.client
        .from('rejplay_chat')
        .select('client_id, nick, color, content, created_at, party_code')
        .order('created_at', { ascending: false })
        .limit(12);
      query = this.partyCode ? query.eq('party_code', this.partyCode) : query.is('party_code', null);
      const { data } = await query;
      if (!data) return;
      for (const row of (data as Record<string, unknown>[]).reverse()) this.receiveChat(row);
    } catch {
      // Historia czatu jest opcjonalna.
    }
  }

  private receiveChat(row: Record<string, unknown>): void {
    const rowParty = row.party_code == null ? null : String(row.party_code);
    const current = this.partyCode ?? null;
    if (rowParty !== current) return;
    const content = String(row.content ?? '').slice(0, 180);
    if (!content) return;
    const nick = String(row.nick ?? 'Gracz').slice(0, 24);
    const own = String(row.client_id ?? '') === this.id;
    const at = Date.parse(String(row.created_at ?? '')) || Date.now();
    const key = String(row.id ?? `${nick}|${content}|${at}`);
    if (own) {
      const sentAt = this.sent.get(`${nick}|${content}`);
      if (sentAt && Date.now() - sentAt < 12000) {
        this.sent.delete(`${nick}|${content}`);
        return; // własna wiadomość już pokazana optymistycznie
      }
    }
    this.onChat?.({
      key,
      nick,
      color: /^#[0-9a-f]{6}$/i.test(String(row.color ?? '')) ? String(row.color) : '#c8a06a',
      content,
      at,
      own,
    });
  }

  async chat(text: string): Promise<void> {
    const content = text.trim().replace(/\s+/g, ' ').slice(0, 180);
    if (!content) return;
    this.sent.set(`${this.local.nick}|${content}`, Date.now());
    this.onChat?.({
      key: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      nick: this.local.nick,
      color: this.local.color,
      content,
      at: Date.now(),
      own: true,
      offline: this.status !== 'online',
    });
    if (!this.client) return;
    try {
      await this.client.from('rejplay_chat').insert({
        client_id: this.id,
        nick: this.local.nick,
        color: this.local.color,
        content,
        party_code: this.partyCode,
      });
    } catch {
      // Lokalna wiadomość już jest na ekranie.
    }
  }

  dispose(): void {
    window.clearInterval(this.heartbeatTimer);
    if (this.channel && this.client) void this.client.removeChannel(this.channel);
    this.channel = null;
    this.client = null;
  }
}
