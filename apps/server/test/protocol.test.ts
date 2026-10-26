import { describe, expect, it } from 'vitest';
import { echoReply, parseRoomPath } from '../src/protocol';

describe('parseRoomPath', () => {
  it('accepts room codes and normalises case', () => {
    expect(parseRoomPath('/ws/abcd')).toBe('ABCD');
    expect(parseRoomPath('/ws/Room42/')).toBe('ROOM42');
  });

  it('rejects other paths', () => {
    for (const path of ['/', '/ws/', '/ws/abc', '/ws/abc-def', '/ws/abcd/extra', '/api/abcd'])
      expect(parseRoomPath(path), path).toBeNull();
  });
});

describe('echoReply', () => {
  it('wraps text and binary messages', () => {
    expect(JSON.parse(echoReply('hi', 'ABCD'))).toEqual({ type: 'echo', room: 'ABCD', data: 'hi' });
    const bytes = new TextEncoder().encode('bin').buffer as ArrayBuffer;
    expect(JSON.parse(echoReply(bytes, 'ABCD')).data).toBe('bin');
  });
});
