import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { renderLoginPage } from '../src/auth-gate.ts'

function bootRegistration(locale: 'zh' | 'en', response: { ok: boolean, status: number, body: unknown }) {
  const elements = new Map<string, any>()
  function element(id: string): any {
    if (!elements.has(id)) elements.set(id, {
      value: id === 'server' ? 'https://harness.example.com' : id === 'username' ? 'new-user' : 'test-password',
      textContent: '', style: { display: 'none' }, disabled: false,
      classList: { add() {}, remove() {}, contains() { return false } },
      getAttribute() { return null }, querySelectorAll() { return [] }, focus() {},
      listeners: {}, addEventListener(name: string, handler: unknown) { this.listeners[name] = handler },
      requestSubmit: vi.fn(),
    })
    return elements.get(id)
  }
  const fetch = vi.fn(async (_url: string, _init?: unknown) => ({ ...response, json: async () => response.body }))
  const replace = vi.fn()
  const html = renderLoginPage(locale).replaceAll('__BRAND_JSON__', JSON.stringify({ login: {} }))
  const script = html.match(/<script>([\s\S]*?)<\/script>/i)![1]!
  runInNewContext(script, {
    document: { getElementById: element },
    location: { search: '', replace }, sessionStorage: { setItem() {} }, fetch,
    setInterval() {}, clearInterval() {}, window: { open() {} },
  })
  return { element, fetch, replace }
}

describe('account registration awaiting approval', () => {
  it.each([
    ['zh', 201, '请联系管理员审批'],
    ['en', 202, 'contact your administrator for approval'],
  ] as const)('shows an approval notice in %s without trying to sign in', async (locale, status, message) => {
    const page = bootRegistration(locale, {
      ok: true, status, body: { user: { status: 2, pending_approval: true } },
    })
    await page.element('register-btn').listeners.click()
    expect(page.fetch).toHaveBeenCalledTimes(1)
    expect(page.fetch.mock.calls[0]![0]).toBe('/api/pico/auth/register')
    expect(page.element('f2').requestSubmit).not.toHaveBeenCalled()
    expect(page.replace).not.toHaveBeenCalled()
    expect(page.element('err-step2').textContent).toBe('')
    expect(page.element('registration-notice').textContent).toContain(message)
    expect(page.element('registration-notice').style.display).toBe('')
    expect(page.element('register-btn').disabled).toBe(false)
  })

  it('shows a registration error without claiming the application was submitted', async () => {
    const page = bootRegistration('zh', {
      ok: false, status: 409, body: { error: { message: 'Account already exists' } },
    })
    await page.element('register-btn').listeners.click()
    expect(page.element('err-step2').textContent).toBe('Account already exists')
    expect(page.element('registration-notice').style.display).toBe('none')
    expect(page.element('f2').requestSubmit).not.toHaveBeenCalled()
    expect(page.element('register-btn').disabled).toBe(false)
  })

  it('clears the previous approval notice when registration fails on retry', async () => {
    const page = bootRegistration('zh', { ok: true, status: 202, body: {} })
    await page.element('register-btn').listeners.click()
    page.fetch.mockRejectedValueOnce(new Error('offline'))
    await page.element('register-btn').listeners.click()
    expect(page.element('err-step2').textContent).toContain('网络错误')
    expect(page.element('registration-notice').style.display).toBe('none')
    expect(page.element('register-btn').disabled).toBe(false)
  })

  it('allows an explicit sign-in after approval and clears the notice', async () => {
    const page = bootRegistration('zh', { ok: true, status: 202, body: {} })
    await page.element('register-btn').listeners.click()
    await page.element('f2').listeners.submit({ preventDefault() {} })
    expect(page.fetch.mock.calls[1]![0]).toBe('/api/pico/auth/login')
    expect(page.replace).toHaveBeenCalledWith('/')
    expect(page.element('registration-notice').style.display).toBe('none')
  })
})
