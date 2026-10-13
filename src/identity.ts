import type { Identity, IdentityInput } from './types.js';

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\[bot\])?$/;
const NOREPLY = '@users.noreply.github.com';

function clean(s: string | null | undefined): string | undefined {
  if (typeof s !== 'string') return undefined;
  const t = s.trim();
  return t === '' ? undefined : t;
}

/**
 * Turns `Jane Doe <jane@example.com>`, `jane@example.com`, `dependabot[bot]` or an identity object into an
 * identity. A single word such as `octocat` is taken as both a login and a name.
 */
export function parseIdentity(input: IdentityInput | null | undefined): Identity {
  if (input === null || input === undefined) return {};
  if (typeof input !== 'string') {
    const out: Identity = {};
    const name = clean(input.name);
    const email = clean(input.email);
    const login = clean(input.login);
    const type = clean(input.type);
    if (name !== undefined) out.name = name;
    if (email !== undefined) out.email = email;
    if (login !== undefined) out.login = login;
    if (type !== undefined) out.type = type;
    return out;
  }
  const s = input.trim();
  if (s === '') return {};
  // "Name <email>", parsed without a regex so that long untrusted lines cannot backtrack.
  if (s.endsWith('>')) {
    const lt = s.lastIndexOf('<');
    if (lt !== -1) {
      const out: Identity = {};
      const name = clean(s.slice(0, lt));
      const email = clean(s.slice(lt + 1, -1));
      if (name !== undefined) out.name = name;
      if (email !== undefined) out.email = email;
      return out;
    }
  }
  if (!/\s/.test(s) && s.includes('@')) return { email: s };
  if (LOGIN.test(s)) return { name: s, login: s };
  return { name: s };
}

/** `49699333+dependabot[bot]@users.noreply.github.com` → `dependabot[bot]`. */
export function loginFromEmail(email: string | undefined | null): string | undefined {
  if (typeof email !== 'string') return undefined;
  const e = email.trim().toLowerCase();
  if (!e.endsWith(NOREPLY)) return undefined;
  let local = e.slice(0, -NOREPLY.length);
  const plus = local.indexOf('+');
  if (plus !== -1 && /^\d+$/.test(local.slice(0, plus))) local = local.slice(plus + 1);
  return LOGIN.test(local) ? local : undefined;
}

/** Every login the identity could belong to, lowercased: its login, the one in a GitHub noreply email, a `[bot]` name. */
export function candidateLogins(id: Identity): string[] {
  const out = new Set<string>();
  if (id.login) out.add(id.login.toLowerCase());
  const fromEmail = loginFromEmail(id.email);
  if (fromEmail) out.add(fromEmail);
  if (id.name && /\[bot\]$/i.test(id.name) && LOGIN.test(id.name)) out.add(id.name.toLowerCase());
  return [...out];
}

const BOT_WORD = /(?:^|[-_.\s])(?:ro)?bot$/i;
const BOT_PREFIX = /^bot[-_.]/i;
const BOT_EMAIL_LOCAL = /^(?:[a-z0-9._%+-]*[-_.+])?(?:ro)?bot$/i;

/**
 * Generic automation-account heuristics, for accounts the registry doesn't list: GitHub `Bot` accounts,
 * `[bot]` logins and names, and names, logins or email local parts that are or end in "bot" as a word
 * (`renovate-bot`, `Release Bot`, `bot@example.com`). "Talbot" and "Abbot" are not bots.
 */
export function looksLikeBot(id: Identity): boolean {
  if (id.type && id.type.toLowerCase() === 'bot') return true;
  if (candidateLogins(id).some((l) => l.endsWith('[bot]'))) return true;
  for (const s of [id.name, id.login]) {
    if (!s) continue;
    if (/\[bot\]$/i.test(s) || BOT_WORD.test(s) || BOT_PREFIX.test(s)) return true;
  }
  if (id.email) {
    const at = id.email.lastIndexOf('@');
    const local = at === -1 ? '' : id.email.slice(0, at);
    if (local && local.length <= 64 && BOT_EMAIL_LOCAL.test(local)) return true;
  }
  return false;
}

/** `Jane Doe <jane@example.com>`, or whichever parts are known. */
export function formatIdentity(id: Identity): string {
  if (id.name && id.email) return `${id.name} <${id.email}>`;
  if (id.email) return `<${id.email}>`;
  return id.login ?? id.name ?? '';
}

/** Whether two identities are the same person or account, judged by email, then login, then name. */
export function sameIdentity(a: Identity, b: Identity): boolean {
  if (a.email && b.email) return a.email.toLowerCase() === b.email.toLowerCase();
  if (a.login && b.login) return a.login.toLowerCase() === b.login.toLowerCase();
  return Boolean(a.name && b.name && a.name === b.name);
}
