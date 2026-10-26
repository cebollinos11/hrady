import { boardContext, neutralCastles, score, type GameState } from '../src';

/** Every consistency rule a reachable state must satisfy. Returns the violations. */
export function checkInvariants(state: GameState): string[] {
  const errors: string[] = [];
  const ctx = boardContext(state.config);
  const { players, rules } = state.config;

  if (!Number.isInteger(state.current) || state.current < 0 || state.current >= players)
    errors.push(`current player ${state.current} out of range`);
  if (state.mp < 0 || state.mp > rules.movePoints) errors.push(`mp ${state.mp} out of range`);
  if (state.phase === 'roll' && (state.mp !== 0 || state.roll !== null))
    errors.push('roll phase with movement points or a roll');
  if (state.phase === 'move' && (state.roll === null || state.roll < 1 || state.roll > 6))
    errors.push(`move phase with roll ${state.roll}`);

  for (const node in state.knights) {
    const counts = state.knights[node]!;
    const type = ctx.type(node);
    if (!type) errors.push(`knights on unknown node ${node}`);
    if (counts.length !== players) errors.push(`${node} has ${counts.length} counts`);
    if (counts.some((n) => !Number.isInteger(n) || n < 0))
      errors.push(`${node} has bad counts ${counts}`);
    const colours = counts.filter((n) => n > 0).length;
    if (colours === 0) errors.push(`${node} has an empty entry`);
    if (colours > 1 && type !== 'start') errors.push(`${node} holds ${colours} colours`);
  }

  for (const id of ctx.castleIds) {
    const c = state.castles[id];
    if (!c) {
      errors.push(`castle ${id} missing`);
      continue;
    }
    const counts = state.knights[id];
    if (c.owner === null) {
      if (counts) errors.push(`neutral castle ${id} has knights`);
      if (c.shield) errors.push(`neutral castle ${id} has a shield`);
    } else if (!counts || (counts[c.owner] ?? 0) < 1) {
      errors.push(`castle ${id} of player ${c.owner} has no garrison`);
    }
  }
  if (Object.keys(state.castles).length !== ctx.castleIds.length)
    errors.push('castle records do not match the board');

  // Each player's shields: unplaced + on castles ⊆ the starting set.
  for (let p = 0; p < players; p++) {
    const used = [...(state.shields[p] ?? [])];
    for (const id of ctx.castleIds) {
      const c = state.castles[id];
      if (c?.owner === p && c.shield) used.push(c.shield.value);
    }
    const left = [...rules.shieldValues];
    for (const v of used) {
      const i = left.indexOf(v);
      if (i < 0) errors.push(`player ${p} has an extra shield ${v}`);
      else left.splice(i, 1);
    }
  }

  if (state.pendingShield !== null) {
    if (state.castles[state.pendingShield]?.owner !== state.current)
      errors.push('pending shield on a castle the current player does not own');
    if (state.castles[state.pendingShield]?.shield)
      errors.push('pending shield on a castle that already has one');
    if (!state.shields[state.current]?.length) errors.push('pending shield without shields left');
  }

  const neutral = neutralCastles(state);
  if (state.phase === 'over') {
    if (neutral.length !== 1) errors.push(`game over with ${neutral.length} neutral castles`);
    if (!state.end || state.end.lastCastle !== neutral[0]) errors.push('bad end record');
  } else {
    if (neutral.length < 2) errors.push(`game running with ${neutral.length} neutral castles`);
    if (state.end) errors.push('end record while running');
  }

  const { points } = score(state);
  const total = ctx.castleIds.reduce((sum, id) => sum + ctx.castleValue(id), 0);
  const scored = points.reduce((a, b) => a + b, 0);
  if (state.phase === 'over' ? scored !== total : scored > total)
    errors.push(`scored ${scored} of ${total} castle points`);
  return errors;
}
