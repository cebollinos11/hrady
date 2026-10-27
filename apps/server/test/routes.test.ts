import { describe, expect, it } from 'vitest';
import { allowOrigin, route } from '../src/routes';

describe('route', () => {
  it('maps the API and socket paths, normalising codes', () => {
    expect(route('GET', '/')).toEqual({ kind: 'home' });
    expect(route('OPTIONS', '/api/rooms')).toEqual({ kind: 'preflight' });
    expect(route('POST', '/api/rooms')).toEqual({ kind: 'create' });
    expect(route('GET', '/api/rooms/abcde')).toEqual({ kind: 'info', code: 'ABCDE' });
    expect(route('POST', '/api/rooms/abcde/status')).toEqual({ kind: 'status', code: 'ABCDE' });
    expect(route('GET', '/ws/Room42/')).toEqual({ kind: 'socket', code: 'ROOM42' });
  });

  it('rejects everything else', () => {
    for (const [method, path] of [
      ['GET', '/api/rooms'],
      ['POST', '/api/rooms/ABCDE'],
      ['GET', '/api/rooms/ABCDE/status'],
      ['GET', '/ws/'],
      ['GET', '/ws/abc'],
      ['GET', '/ws/abc-def'],
      ['GET', '/ws/abcd/extra'],
      ['DELETE', '/api/rooms/ABCDE'],
    ] as const)
      expect(route(method, path), `${method} ${path}`).toEqual({ kind: 'notFound' });
  });
});

describe('allowOrigin', () => {
  it('allows any origin with * and listed origins otherwise', () => {
    expect(allowOrigin('https://a.example', undefined)).toBe('*');
    expect(allowOrigin(null, '*')).toBe('*');
    const list = 'https://a.example, http://localhost:5173/';
    expect(allowOrigin('https://a.example', list)).toBe('https://a.example');
    expect(allowOrigin('http://localhost:5173', list)).toBe('http://localhost:5173');
    expect(allowOrigin('https://evil.example', list)).toBeNull();
    expect(allowOrigin(null, list)).toBeNull();
  });
});
