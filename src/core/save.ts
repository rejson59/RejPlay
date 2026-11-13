import type { GameId, GameResult, SaveLike } from './types';

const PREFIX = 'rejplay:gabinet:v1:';

export class Store implements SaveLike {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch { return fallback; }
  }

  set<T>(key: string, value: T): void {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* prywatny */ }
  }

  best(game: GameId): GameResult | null {
    return this.get<GameResult | null>(`best:${game}`, null);
  }

  record(game: GameId, result: GameResult): void {
    const previous = this.best(game);
    if (!previous || result.score > previous.score) this.set(`best:${game}`, result);
    this.set(`last:${game}`, result);
    const plays = this.get<number>(`plays:${game}`, 0) + 1;
    this.set(`plays:${game}`, plays);
  }

  plays(game: GameId): number { return this.get<number>(`plays:${game}`, 0); }
}
