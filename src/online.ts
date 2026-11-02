import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { Appearance } from './character';

/**
 * Warstwa sieciowa RejPlay → Supabase `rejson-widgets`.
 *
 * Używamy WYŁĄCZNIE klucza publishable/anon (bezpiecznego dla przeglądarki).
 * Klucz service_role i sekrety nigdy nie trafiają do frontendu. RLS na
 * tabelach rejplay_* dopuszcza anon; migracja w supabase/migrations/.
 *
 * Multiplayer = Realtime Presence (pozycje, wygląd, ruch) + Realtime
 * postgres_changes na czacie. Jeśli sieć/Supabase jest niedostępne, gra dalej
 * działa w pełni lokalnie — status przechodzi w „offline”.
 */

const URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://hzbqzfimtroixnldzjeq.supabase.co';
const KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  'sb_publishable_PeNxhJkouoKnAyFFmqXDdg_XbS_XtcX';

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

export class OnlineClient {
  readonly id: string;
  status: OnlineStatus = 'connecting';
  onPeers?: (peers: OnlinePeer[]) => void;
  onChat?: (message: OnlineChatMessage) => void;
  onStatus?: (status: OnlineStatus) => void;

  private client: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;
  private local: LocalState;
  private lastTrack = 0;
  private everOnline = false;
  private stopped = false;
  private readonly sent = new Map<string, number>();
  private peers: OnlinePeer[] = [];

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
      const channel = this.client
        .channel('rejplay:atrium', { config: { presence: { key: this.id } } })
        .on('presence', { event: 'sync' }, () => this.syncPeers())
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'rejplay_chat' },
          (payload) => this.receiveChat(payload.new as Record<string, unknown>),
        );
      this.channel = channel;
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          this.everOnline = true;
          this.setStatus('online');
          void this.track(true);
          void this.saveProfile();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          this.setStatus('offline');
          // Jeśli nigdy nie udało się połączyć, wyłączamy kanał: Realtime
          // próbowałby bez końca i zasypywał konsolę błędami sieci.
          if (!this.everOnline) this.stopRetrying();
        }
      });
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
      });
    }
    this.peers = peers;
    this.onPeers?.(peers);
  }

  /** Pozycja/ wygląd wysyłane najwyżej ~8 razy na sekundę. */
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
      await channel.track({ ...this.local, id: this.id });
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

  private async loadRecentChat(): Promise<void> {
    if (!this.client) return;
    try {
      const { data } = await this.client
        .from('rejplay_chat')
        .select('client_id, nick, color, content, created_at')
        .order('created_at', { ascending: false })
        .limit(12);
      if (!data) return;
      for (const row of (data as Record<string, unknown>[]).reverse()) this.receiveChat(row);
    } catch {
      // Historia czatu jest opcjonalna.
    }
  }

  private receiveChat(row: Record<string, unknown>): void {
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
      });
    } catch {
      // Lokalna wiadomość już jest na ekranie.
    }
  }

  dispose(): void {
    if (this.channel && this.client) void this.client.removeChannel(this.channel);
    this.channel = null;
    this.client = null;
  }
}
