import { createHash, randomBytes } from 'node:crypto';
import { COLORS, type MockUser } from '@fortnight/shared';

const AVATAR_COLORS = COLORS.filter((c) => c !== 'default');

/**
 * Mock user derived from a login name (decision D2): same name (ignoring case and extra spaces)
 * gives the same id, initials and color. Not a real account.
 */
export function mockUserFromName(rawName: string): MockUser {
  const name = rawName.trim().replace(/\s+/g, ' ');
  const hash = createHash('sha256').update(name.toLowerCase()).digest('hex');
  const words = name.split(' ').filter(Boolean);
  const firstChar = (w: string) => Array.from(w)[0] ?? '';
  const initials =
    words.length >= 2
      ? firstChar(words[0]!) + firstChar(words[1]!)
      : Array.from(words[0] ?? '?')
          .slice(0, 1)
          .join('');
  const color = AVATAR_COLORS[parseInt(hash.slice(0, 8), 16) % AVATAR_COLORS.length]!;
  return { id: `u_${hash.slice(0, 16)}`, name, initials: initials.toUpperCase(), color };
}

/** In-memory sessions. A server restart logs everyone out. */
export class SessionStore {
  private readonly sessions = new Map<string, MockUser>();

  create(name: string): { sid: string; user: MockUser } {
    const sid = randomBytes(32).toString('base64url');
    const user = mockUserFromName(name);
    this.sessions.set(sid, user);
    return { sid, user };
  }

  get(sid: string | undefined): MockUser | undefined {
    return sid ? this.sessions.get(sid) : undefined;
  }

  delete(sid: string | undefined): void {
    if (sid) this.sessions.delete(sid);
  }

  get size(): number {
    return this.sessions.size;
  }
}
