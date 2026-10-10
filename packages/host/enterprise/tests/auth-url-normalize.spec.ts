import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertServerURLAllowed, login, normalizeServerURL } from '../src/server-connector/auth.ts'

afterEach(() => vi.unstubAllGlobals())

describe('normalizeServerURL', () => {
  it('strips a single trailing slash', () => {
    expect(normalizeServerURL('https://ai.example.com/')).toBe('https://ai.example.com')
  })

  it('strips multiple trailing slashes', () => {
    expect(normalizeServerURL('https://ai.example.com///')).toBe('https://ai.example.com')
  })

  it('keeps a slash-free URL unchanged', () => {
    expect(normalizeServerURL('https://ai.example.com')).toBe('https://ai.example.com')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeServerURL('  https://ai.example.com/  ')).toBe('https://ai.example.com')
  })

  it('does not strip path segments (only the trailing slash)', () => {
    // 服务端地址可能带上下文路径(如 https://host/gateway);只去尾部斜杠,
    // 不能把路径段剥掉——/gateway 与 /gateway/ 应归一为 /gateway。
    expect(normalizeServerURL('https://ai.example.com/gateway/')).toBe('https://ai.example.com/gateway')
    expect(normalizeServerURL('https://ai.example.com/gateway')).toBe('https://ai.example.com/gateway')
  })

  it('keeps loopback http URLs intact', () => {
    expect(normalizeServerURL('http://127.0.0.1:8091/')).toBe('http://127.0.0.1:8091')
  })

  it('handles a bare protocol host with trailing slash after a port', () => {
    expect(normalizeServerURL('http://localhost:37532/')).toBe('http://localhost:37532')
  })

  it('allows an internal HTTP base through the real login request path', async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json({ token: 'token-1' }))
    vi.stubGlobal('fetch', request)
    assertServerURLAllowed('http://intranet.example.com')
    await expect(login('http://intranet.example.com/', 'alice', 'password')).resolves.toMatchObject({
      serverURL: 'http://intranet.example.com',
      username: 'alice',
      token: 'token-1',
    })
    expect(request).toHaveBeenCalledWith('http://intranet.example.com/api/client/v2/auth/login', expect.objectContaining({ method: 'POST' }))
  })

  it.each(['ftp://intranet.example.com', 'file:///tmp/server'])('still rejects non-HTTP scheme %s', (serverURL) => {
    expect(() => assertServerURLAllowed(serverURL)).toThrow()
  })
})
