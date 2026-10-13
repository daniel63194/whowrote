// A small stand-in for the GitHub API, so tests never touch the network.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakePull {
  number: number;
  title: string;
  body: string | null;
  user: { login: string; type: string };
  head: { ref: string };
  commits?: unknown[];
  files?: string[];
}

export interface FakeGitHub {
  url: string;
  requests: { method: string; path: string; auth: string | undefined; body: string }[];
  close: () => Promise<void>;
}

export function ghCommit(name: string, email: string, message: string, login?: string, type = 'User'): unknown {
  return { commit: { message, author: { name, email }, committer: { name: 'GitHub', email: 'noreply@github.com' } }, author: login ? { login, type } : null, committer: null };
}

export async function fakeGitHub(options: { pulls: FakePull[]; commitPulls?: Record<string, number[]>; rateLimited?: string[] }): Promise<FakeGitHub> {
  const requests: FakeGitHub['requests'] = [];
  const byNumber = new Map(options.pulls.map((p) => [p.number, p]));
  const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  const page = (items: unknown[], url: URL) => {
    const per = Number(url.searchParams.get('per_page') ?? 30);
    const p = Number(url.searchParams.get('page') ?? 1);
    return items.slice((p - 1) * per, p * per);
  };
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (d: Buffer) => (body += d.toString()));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      requests.push({ method: req.method ?? 'GET', path: `${url.pathname}${url.search}`, auth: req.headers.authorization, body });
      if (options.rateLimited?.some((p) => url.pathname.startsWith(p))) {
        send(res, 403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/graphql') {
        const { query } = JSON.parse(body) as { query: string };
        const repository: Record<string, unknown> = {};
        const errors: unknown[] = [];
        for (const m of query.matchAll(/p(\d+): pullRequest\(number: (\d+)\)/g)) {
          const pr = byNumber.get(Number(m[2]));
          if (!pr) {
            repository[`p${m[1]}`] = null;
            errors.push({ type: 'NOT_FOUND', message: `Could not resolve to a PullRequest with the number of ${m[2]}.` });
            continue;
          }
          const bot = pr.user.type === 'Bot';
          repository[`p${m[1]}`] = {
            number: pr.number,
            title: pr.title,
            body: pr.body,
            headRefName: pr.head.ref,
            author: { __typename: bot ? 'Bot' : 'User', login: bot ? pr.user.login.replace(/\[bot\]$/, '') : pr.user.login },
          };
        }
        send(res, 200, { data: { repository }, ...(errors.length ? { errors } : {}) });
        return;
      }
      let m = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)(\/commits|\/files)?$/.exec(url.pathname);
      if (m) {
        const pr = byNumber.get(Number(m[3]));
        if (!pr) {
          send(res, 404, { message: 'Not Found' });
          return;
        }
        if (m[4] === '/commits') send(res, 200, page(pr.commits ?? [], url));
        else if (m[4] === '/files') send(res, 200, page((pr.files ?? []).map((filename) => ({ filename })), url));
        else send(res, 200, { number: pr.number, html_url: `https://github.com/${m[1]}/${m[2]}/pull/${pr.number}`, title: pr.title, body: pr.body, user: pr.user, head: pr.head });
        return;
      }
      m = /^\/repos\/[^/]+\/[^/]+\/commits\/([0-9a-f]+)\/pulls$/.exec(url.pathname);
      if (m) {
        const numbers = options.commitPulls?.[m[1]!] ?? [];
        send(res, 200, numbers.flatMap((n) => {
          const pr = byNumber.get(n);
          return pr ? [{ number: pr.number, title: pr.title, body: pr.body, user: pr.user, head: pr.head }] : [];
        }));
        return;
      }
      send(res, 404, { message: 'Not Found' });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
