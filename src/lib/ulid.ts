const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Generate a sortable 26-char ULID without external dependencies. */
export function ulid(now = Date.now()): string {
  let t = now;
  let timePart = '';
  for (let i = 0; i < 10; i++) {
    timePart = CROCKFORD[t % 32] + timePart;
    t = Math.floor(t / 32);
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let randPart = '';
  for (let i = 0; i < 16; i++) {
    randPart += CROCKFORD[bytes[i] & 31];
  }
  return timePart + randPart;
}
