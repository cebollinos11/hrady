import { describe, expect, it } from 'vitest';
import {
  CODE_ALPHABET,
  ProtocolError,
  asyncSeatProblem,
  makeCode,
  normaliseCode,
  normaliseName,
  parseClientMessage,
  parseCreateRoom,
  parseProfileUpdate,
  parseStatusRequest,
  profileKey,
} from '../src';

const parse = (v: unknown) => parseClientMessage(JSON.stringify(v));

describe('parseClientMessage', () => {
  it('accepts every message type', () => {
    expect(parse({ type: 'hello', name: ' Ann ' })).toEqual({ type: 'hello', name: 'Ann' });
    expect(parse({ type: 'hello', name: 'Ann', token: 'abcdefgh12' })).toEqual({
      type: 'hello',
      name: 'Ann',
      token: 'abcdefgh12',
    });
    expect(parse({ type: 'sit', seat: 2 })).toEqual({ type: 'sit', seat: 2 });
    expect(parse({ type: 'setSeat', seat: 1, kind: 'hard' })).toEqual({
      type: 'setSeat',
      seat: 1,
      kind: 'hard',
    });
    expect(parse({ type: 'setOptions', players: 5, turnSeconds: 60 })).toEqual({
      type: 'setOptions',
      players: 5,
      turnSeconds: 60,
    });
    for (const type of ['stand', 'start', 'back', 'leave'])
      expect(parse({ type })).toEqual({ type });
    expect(parse({ type: 'undo', to: 3, at: 5 })).toEqual({ type: 'undo', to: 3, at: 5 });
  });

  it('rebuilds actions with only the fields the engine reads', () => {
    const msg = parse({
      type: 'act',
      at: 7,
      action: {
        type: 'attackField',
        player: 1,
        target: 'p3',
        contributions: [{ from: 'p2', count: 2, junk: 1 }],
        extra: 'x'.repeat(100),
      },
    });
    expect(msg).toEqual({
      type: 'act',
      at: 7,
      action: {
        type: 'attackField',
        player: 1,
        target: 'p3',
        contributions: [{ from: 'p2', count: 2 }],
      },
    });
    expect(parse({ type: 'act', at: 0, action: { type: 'roll', player: 0, seed: 1 } })).toEqual({
      type: 'act',
      at: 0,
      action: { type: 'roll', player: 0 },
    });
  });

  it('rejects malformed messages with a reason', () => {
    const bad: unknown[] = [
      null,
      [],
      { type: 'nope' },
      { type: 'hello', name: '   ' },
      { type: 'hello', name: 'A', token: 'short' },
      { type: 'sit', seat: 9 },
      { type: 'sit', seat: 1.5 },
      { type: 'setSeat', seat: 0, kind: 'human' },
      { type: 'setOptions', players: 2 },
      { type: 'setOptions', turnSeconds: 61 },
      { type: 'act', at: -1, action: { type: 'roll', player: 0 } },
      { type: 'act', at: 0, action: { type: 'roll', player: 7 } },
      { type: 'act', at: 0, action: { type: 'move', player: 0, from: 'a', to: 'b', count: 0 } },
      { type: 'act', at: 0, action: { type: 'move', player: 0, from: '<x>', to: 'b', count: 1 } },
      {
        type: 'act',
        at: 0,
        action: { type: 'attackField', player: 0, target: 'a', contributions: [] },
      },
      { type: 'act', at: 0, action: { type: 'teleport', player: 0 } },
    ];
    for (const v of bad) expect(() => parse(v), JSON.stringify(v)).toThrow(ProtocolError);
    expect(() => parseClientMessage('{')).toThrow(ProtocolError);
    expect(() => parseClientMessage(' '.repeat(5000))).toThrow('too long');
  });
});

describe('names and codes', () => {
  it('normalises names', () => {
    expect(normaliseName('  Ann \n  Lee\u0007 ')).toBe('Ann Lee');
    expect(normaliseName('x'.repeat(50))).toHaveLength(20);
    expect(normaliseName(42)).toBeNull();
    expect(normaliseName('\u0001')).toBeNull();
  });

  it('makes and normalises room codes', () => {
    let i = 0;
    const code = makeCode(() => (i++ * 0.37) % 1);
    expect(code).toMatch(new RegExp(`^[${CODE_ALPHABET}]{5}$`));
    expect(normaliseCode(` ${code.toLowerCase()} `)).toBe(code);
    expect(normaliseCode('ab')).toBeNull();
    expect(normaliseCode('ab-cd')).toBeNull();
  });

  it('parses room creation requests', () => {
    expect(parseCreateRoom({ name: 'Ann', players: 4 })).toEqual({ name: 'Ann', players: 4 });
    expect(parseCreateRoom({ name: 'Ann' })).toEqual({ name: 'Ann' });
    expect(() => parseCreateRoom({ name: 'Ann', players: 6 })).toThrow(ProtocolError);
    expect(() => parseCreateRoom({})).toThrow(ProtocolError);
    expect(parseCreateRoom({ name: 'Ann', mode: 'async' })).toEqual({ name: 'Ann', mode: 'async' });
    expect(() => parseCreateRoom({ name: 'Ann', mode: 'turbo' })).toThrow(ProtocolError);
  });

  it('parses status requests', () => {
    expect(parseStatusRequest({ token: 'abcdefgh12' })).toEqual({ token: 'abcdefgh12' });
    expect(() => parseStatusRequest({ token: 'short' })).toThrow(ProtocolError);
    expect(() => parseStatusRequest({})).toThrow(ProtocolError);
  });
});

describe('usernames', () => {
  it('keys names case-insensitively and refuses blank ones', () => {
    expect(profileKey('  Ann  Lee ')).toBe('ann lee');
    expect(profileKey('ANN')).toBe(profileKey('ann'));
    expect(profileKey('   ')).toBeNull();
    expect(profileKey('')).toBeNull();
  });

  it('parses profile updates', () => {
    expect(parseProfileUpdate({ add: { code: 'abcde', token: 'abcdefgh12' } })).toEqual({
      add: { code: 'ABCDE', token: 'abcdefgh12' },
    });
    expect(parseProfileUpdate({ forget: 'abcde' })).toEqual({ forget: 'ABCDE' });
    for (const bad of [
      null,
      {},
      { add: {} },
      { add: { code: 'ab', token: 'abcdefgh12' } },
      { add: { code: 'ABCDE', token: 'x' } },
      { forget: 5 },
    ])
      expect(() => parseProfileUpdate(bad), JSON.stringify(bad)).toThrow(ProtocolError);
  });
});

describe('asyncSeatProblem', () => {
  const human = (member: string) => ({ type: 'human' as const, member });
  const bot = { type: 'bot' as const };

  it('accepts bots that sit right before the host, wrapping around', () => {
    expect(asyncSeatProblem([human('h'), human('g'), bot, bot], 'h')).toBeNull();
    expect(asyncSeatProblem([bot, human('h'), human('g'), bot], 'h')).toBeNull();
    expect(asyncSeatProblem([human('g'), bot, bot, human('h')], 'h')).toBeNull();
    expect(asyncSeatProblem([human('h'), bot, bot], 'h')).toBeNull();
    expect(asyncSeatProblem([human('h'), human('g'), human('i')], 'h')).toBeNull();
  });

  it('refuses a bot before another human and a host without a seat', () => {
    expect(asyncSeatProblem([human('h'), bot, human('g')], 'h')).toMatch(/right before the host/);
    expect(asyncSeatProblem([human('g'), human('h'), bot, bot], 'h')).toMatch(/right before/);
    expect(asyncSeatProblem([human('g'), bot, human('i')], null)).toMatch(/host must take a seat/);
    expect(asyncSeatProblem([bot, bot, human('g')], 'h')).toMatch(/host must take a seat/);
  });
});
