/// <reference lib="webworker" />
import { createBot, type Bot, type Level, type Observation } from '@hrady/ai';
import type { Action, PlayerId } from '@hrady/engine';

/** Asks the bot of a seat for its next action. */
export interface BotRequest {
  id: number;
  player: PlayerId;
  level: Level;
  seed: number;
  obs: Observation;
}

export type BotResponse = { id: number; action: Action } | { id: number; error: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** One bot per seat and level; bots keep their turn plan between requests. */
const bots = new Map<string, Bot>();

scope.onmessage = (e: MessageEvent<BotRequest>) => {
  const { id, player, level, seed, obs } = e.data;
  const key = `${player}:${level}:${seed}`;
  let bot = bots.get(key);
  if (!bot) bots.set(key, (bot = createBot(level, seed)));
  let response: BotResponse;
  try {
    response = { id, action: bot.act(obs) };
  } catch (err) {
    response = { id, error: err instanceof Error ? err.message : String(err) };
  }
  scope.postMessage(response);
};
