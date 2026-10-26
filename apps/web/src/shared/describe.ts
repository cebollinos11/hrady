import type { Board } from '@hrady/board';
import type { GameEvent, PlayerId } from '@hrady/engine';

export const PLAYER_NAMES = ['Red', 'Blue', 'Yellow', 'Green', 'Purple'] as const;
export const PLAYER_COLOURS = ['#d23c32', '#2f6fd6', '#e8b800', '#2e9e44', '#8e44c8'] as const;

export const playerName = (p: PlayerId) => PLAYER_NAMES[p] ?? `Player ${p + 1}`;

/** Human-readable name of a node: castle name, "start N" or the marker id. */
export function nodeName(board: Board, id: string): string {
  const node = board.nodes.get(id);
  if (node?.type === 'castle') return node.name;
  if (node?.type === 'start') return `start ${node.number}`;
  return id;
}

const knights = (n: number) => `${n} knight${n === 1 ? '' : 's'}`;

/** One line of the action log. */
export function describeEvent(board: Board, e: GameEvent): string {
  const who = playerName(e.player);
  const at = (id: string) => nodeName(board, id);
  switch (e.type) {
    case 'rolled':
      return `${who} rolls ${e.value}`;
    case 'knightPlaced':
      return `${who} places a knight on ${at(e.start)}`;
    case 'placementSkipped':
      return `${who} already has a knight on ${at(e.start)}: no placement`;
    case 'moved':
      return `${who} moves ${knights(e.count)} ${at(e.from)} → ${at(e.to)}`;
    case 'fieldBattle': {
      const from = e.contributions.map((c) => `${c.count} from ${at(c.from)}`).join(', ');
      return `${who} attacks ${at(e.target)} (${from}) and beats ${knights(e.defeated)} of ${playerName(e.defender)}`;
    }
    case 'castleAttacked': {
      const defence =
        e.defender === null
          ? `neutral, ${e.garrison} sword${e.garrison === 1 ? '' : 's'}`
          : `${playerName(e.defender)}, ${knights(e.garrison)}`;
      const shield = e.shield === null ? '' : `, shield ${e.shield}`;
      return `${who} attacks ${at(e.castle)} (${defence}${shield}) with ${e.attackers} from ${at(e.from)}: ${e.won ? 'won' : 'lost'}`;
    }
    case 'castleConquered':
      return `${who} takes ${at(e.castle)}, ${knights(e.count)} move${e.count === 1 ? 's' : ''} in`;
    case 'shieldPlaced':
      return `${who} places a shield on ${at(e.castle)}`;
    case 'turnEnded':
      return `${who} ends the turn`;
    case 'gameOver': {
      const points = e.points.map((p, i) => `${playerName(i)} ${p}`).join(', ');
      const winners = e.winners.map(playerName).join(' and ');
      return `Game over: ${at(e.lastCastle)} is the last neutral castle. ${points}. ${winners} win${e.winners.length === 1 ? 's' : ''}`;
    }
  }
}
