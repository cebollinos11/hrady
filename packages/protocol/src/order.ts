/** The part of a seat the async seat-order rule looks at (satisfied by `SeatInfo` and the server's `Seat`). */
export interface OrderSeat {
  type: 'open' | 'human' | 'bot';
  member?: string;
}

/**
 * Why an async game cannot start with these seats, or `null`. Computer
 * players run in the host's browser, so going clockwise from the host the
 * humans must come first and every bot must be followed by another bot or by
 * the host; otherwise a human would wait for a host who is not online.
 */
export function asyncSeatProblem(seats: readonly OrderSeat[], host: string | null): string | null {
  const hostSeat = seats.findIndex((s) => s.type === 'human' && s.member === host);
  if (hostSeat < 0) return 'The host must take a seat: the computer players run in their browser.';
  for (let i = 0; i < seats.length; i++) {
    if (seats[i]!.type !== 'bot') continue;
    const next = (i + 1) % seats.length;
    if (next !== hostSeat && seats[next]!.type !== 'bot')
      return 'In an async game the computer players must sit right before the host in turn order.';
  }
  return null;
}
