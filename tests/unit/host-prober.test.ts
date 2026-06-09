import { describe, expect, test } from 'bun:test';
import { createHttpHostProber } from '../../src/adapters/host-prober-http.js';

/** A `fetch` stub that returns `res()` (or throws if `res` throws) for any request. */
function fetchReturning(res: () => Response): typeof fetch {
  return (async () => res()) as unknown as typeof fetch;
}

describe('createHttpHostProber.classify', () => {
  test('GitLab manifest with short_name → gitlab', async () => {
    const prober = createHttpHostProber({
      fetch: fetchReturning(
        () =>
          new Response(JSON.stringify({ name: 'GitLab', short_name: 'GitLab' }), { status: 200 }),
      ),
    });
    expect(await prober.classify('code.acme.com')).toBe('gitlab');
  });

  test('GitLab manifest with only name → gitlab', async () => {
    const prober = createHttpHostProber({
      fetch: fetchReturning(
        () => new Response(JSON.stringify({ name: 'GitLab' }), { status: 200 }),
      ),
    });
    expect(await prober.classify('code.acme.com')).toBe('gitlab');
  });

  test('a 200 manifest that is not GitLab JSON → null', async () => {
    const prober = createHttpHostProber({
      fetch: fetchReturning(
        () => new Response(JSON.stringify({ name: 'Some Other App' }), { status: 200 }),
      ),
    });
    expect(await prober.classify('code.acme.com')).toBeNull();
  });

  test('a non-200 response (login redirect / 404) → null', async () => {
    const prober = createHttpHostProber({
      fetch: fetchReturning(() => new Response('go away', { status: 404 })),
    });
    expect(await prober.classify('code.acme.com')).toBeNull();
  });

  test('a 200 that is not JSON → null', async () => {
    const prober = createHttpHostProber({
      fetch: fetchReturning(() => new Response('<html>login</html>', { status: 200 })),
    });
    expect(await prober.classify('code.acme.com')).toBeNull();
  });

  test('network error → null', async () => {
    const prober = createHttpHostProber({
      fetch: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch,
    });
    expect(await prober.classify('code.acme.com')).toBeNull();
  });

  test('timeout (AbortError) → null', async () => {
    const prober = createHttpHostProber({
      timeoutMs: 1,
      fetch: (async () => {
        throw new DOMException('The operation timed out.', 'TimeoutError');
      }) as unknown as typeof fetch,
    });
    expect(await prober.classify('code.acme.com')).toBeNull();
  });

  test('empty hostname short-circuits to null without fetching', async () => {
    let called = false;
    const prober = createHttpHostProber({
      fetch: (async () => {
        called = true;
        return new Response('', { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(await prober.classify('')).toBeNull();
    expect(called).toBe(false);
  });
});
