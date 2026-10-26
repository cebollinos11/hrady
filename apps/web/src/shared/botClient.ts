import type { Level, Observation } from '@hrady/ai';
import type { Action, PlayerId } from '@hrady/engine';
import type { BotRequest, BotResponse } from './bot.worker';

/**
 * Asks the bots in `bot.worker.ts` for moves, one request at a time. The
 * worker starts on the first request; a request made while another is out
 * supersedes it (its answer is dropped).
 */
export class BotClient {
  private worker: Worker | null = null;
  private pending: {
    id: number;
    resolve: (action: Action | null) => void;
    reject: (err: Error) => void;
  } | null = null;
  private next = 1;

  get thinking() {
    return this.pending !== null;
  }

  private start(): Worker {
    const w = new Worker(new URL('./bot.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<BotResponse>) => {
      const res = e.data;
      const pending = this.pending;
      if (!pending || res.id !== pending.id) return;
      this.pending = null;
      if ('error' in res) pending.reject(new Error(res.error));
      else pending.resolve(res.action);
    };
    w.onerror = (e) => {
      const pending = this.pending;
      this.pending = null;
      pending?.reject(new Error(`Bot worker failed: ${e.message}`));
    };
    return w;
  }

  /**
   * The next action of `player`'s bot. Resolves with `null` when the request
   * was cancelled or superseded.
   */
  request(player: PlayerId, level: Level, seed: number, obs: Observation): Promise<Action | null> {
    this.cancel();
    this.worker ??= this.start();
    const id = this.next++;
    const message: BotRequest = { id, player, level, seed, obs };
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject };
      this.worker!.postMessage(message);
    });
  }

  /** Drops the answer to the request out, if any. */
  cancel() {
    const pending = this.pending;
    this.pending = null;
    pending?.resolve(null);
  }
}
