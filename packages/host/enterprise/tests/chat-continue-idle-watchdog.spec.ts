/**
 * ChatContinue regression: idleWatchdog must end a demand the transport abandons.
 *
 * Pin `dsh-timeout@0.2.0-rc.2` awaited `iterator.next()` only. When undici drops
 * the abort on an in-flight body read, the agent stayed `running` and the
 * composer could not start a new turn (session busy). Harmony
 * `dbb150ff0` / latest races the demand against the idle deadline; 神机 ports
 * that via `patches/dsh-timeout@0.2.0-rc.2.patch`.
 *
 * Companion: `patches/dsh-llm-deepseek@0.2.0-rc.2.patch` must not `await`
 * `iterator.return()` after abort (that queues behind the abandoned demand).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { idleWatchdog, TimeoutReason, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { describe, expect, it } from 'vitest'

describe('ChatContinue idleWatchdog (patched dsh-timeout)', () => {
  it('rejects within the idle window when iterator.next never settles', async () => {
    const watchdog = idleWatchdog(undefined, 40, 'MESSAGES_IDLE')
    const abandoned: AsyncIterator<unknown> = {
      next: () => new Promise(() => {
        /* intentionally ignore abort — models undici dropping body-read errors */
      }),
    }

    try {
      const started = Date.now()
      await expect(watchdog.next(abandoned)).rejects.toBeInstanceOf(TimeoutReason)
      const elapsed = Date.now() - started
      expect(elapsed).toBeGreaterThanOrEqual(35)
      expect(elapsed).toBeLessThan(3_000)
      expect(timeoutOf(watchdog.signal, 'MESSAGES_IDLE')).toBeInstanceOf(TimeoutReason)
    } finally {
      watchdog[Symbol.dispose]()
    }
  })

  it('still yields when the iterator progresses before the idle deadline', async () => {
    const watchdog = idleWatchdog(undefined, 500, 'MESSAGES_IDLE')
    let n = 0
    const iterator: AsyncIterator<number> = {
      next: async () => {
        n += 1
        if (n === 1) return { value: 7, done: false }
        return { value: undefined as unknown as number, done: true }
      },
    }
    try {
      await expect(watchdog.next(iterator)).resolves.toEqual({ value: 7, done: false })
      await expect(watchdog.next(iterator)).resolves.toEqual({ value: undefined, done: true })
      expect(timeoutOf(watchdog.signal, 'MESSAGES_IDLE')).toBeUndefined()
    } finally {
      watchdog[Symbol.dispose]()
    }
  })

  it('ships the ChatContinue patch anchors in installed dsh-timeout / dsh-llm-deepseek', () => {
    const timeoutJs = readFileSync(
      resolve(import.meta.dirname, '../node_modules/@deepseek-ai/dsh-timeout/lib/index.js'),
      'utf8',
    )
    expect(timeoutJs).toContain('ChatContinue')
    expect(timeoutJs).toContain('Promise.race')
    expect(timeoutJs).toContain('rejectExpired')

    const deepseekJs = readFileSync(
      resolve(import.meta.dirname, '../node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js'),
      'utf8',
    )
    expect(deepseekJs).toContain('ChatContinue')
    expect(deepseekJs).toContain('void iterator.return(void 0).catch')
    expect(deepseekJs).not.toMatch(/await iterator\.return\(void 0\)/)
  })
})
