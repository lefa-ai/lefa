import assert from 'node:assert/strict'
import { describe, expect, it, vi } from 'vitest'

const redisMock = vi.hoisted(() => {
  const configs = []
  const hsetnx = vi.fn().mockResolvedValue(1)
  const hlen = vi.fn().mockResolvedValue(3)

  return {
    configs,
    hsetnx,
    hlen,
    Redis: class {
      constructor(config) {
        configs.push(config)
      }

      hsetnx(...args) {
        return hsetnx(...args)
      }

      hlen(...args) {
        return hlen(...args)
      }
    }
  }
})

vi.mock('@upstash/redis', () => ({ Redis: redisMock.Redis }))

import handler, { handleWaitlist, redisConfig } from './waitlist.js'

function createResponse() {
  const response = {
    status: vi.fn(() => response),
    json: vi.fn(() => response)
  }

  return response
}

function createStore() {
  return {
    hsetnx: vi.fn().mockResolvedValue(1),
    hlen: vi.fn().mockResolvedValue(1)
  }
}

describe('waitlist API', () => {
  it('selects supported Redis environment variables in priority order', () => {
    assert.deepEqual(
      redisConfig({
        KV_REST_API_URL: 'fixture-kv-url',
        UPSTASH_REDIS_REST_URL: 'fixture-upstash-url',
        UPSTASH_REDIS_REST_KV_REST_API_URL: 'fixture-marketplace-url',
        KV_REST_API_TOKEN: 'fixture-kv-token',
        UPSTASH_REDIS_REST_TOKEN: 'fixture-upstash-token',
        UPSTASH_REDIS_REST_KV_REST_API_TOKEN: 'fixture-marketplace-token'
      }),
      { url: 'fixture-kv-url', token: 'fixture-kv-token' }
    )
    assert.deepEqual(
      redisConfig({
        UPSTASH_REDIS_REST_URL: 'fixture-upstash-url',
        UPSTASH_REDIS_REST_TOKEN: 'fixture-upstash-token',
        UPSTASH_REDIS_REST_KV_REST_API_URL: 'fixture-marketplace-url',
        UPSTASH_REDIS_REST_KV_REST_API_TOKEN: 'fixture-marketplace-token'
      }),
      { url: 'fixture-upstash-url', token: 'fixture-upstash-token' }
    )
    assert.deepEqual(
      redisConfig({
        UPSTASH_REDIS_REST_KV_REST_API_URL: 'fixture-marketplace-url',
        UPSTASH_REDIS_REST_KV_REST_API_TOKEN: 'fixture-marketplace-token'
      }),
      { url: 'fixture-marketplace-url', token: 'fixture-marketplace-token' }
    )
    assert.deepEqual(redisConfig({}), { url: undefined, token: undefined })
  })

  it('uses one lazily created Redis client in the default handler', async () => {
    const response = createResponse()
    const request = { method: 'POST', body: { email: 'person@example.com' } }

    await handler(request, response)
    await handler(request, response)

    expect(redisMock.configs).toHaveLength(1)
    expect(redisMock.hsetnx).toHaveBeenCalledTimes(2)
    expect(response.json).toHaveBeenLastCalledWith({ ok: true, count: 3 })
  })

  it('rejects methods other than POST without touching storage', async () => {
    const response = createResponse()
    const store = createStore()

    await handleWaitlist({ method: 'GET' }, response, store)

    expect(response.status).toHaveBeenCalledWith(405)
    expect(response.json).toHaveBeenCalledWith({ error: 'method_not_allowed' })
    expect(store.hsetnx).not.toHaveBeenCalled()
  })

  it('normalizes and stores an object-body email', async () => {
    const response = createResponse()
    const store = createStore()
    store.hlen.mockResolvedValue(42)

    await handleWaitlist(
      { method: 'POST', body: { email: '  Person@Example.COM  ' } },
      response,
      store
    )

    expect(store.hsetnx).toHaveBeenCalledOnce()
    const [key, email, timestamp] = store.hsetnx.mock.calls[0]
    assert.equal(key, 'waitlist')
    assert.equal(email, 'person@example.com')
    assert.equal(new Date(timestamp).toISOString(), timestamp)
    expect(store.hlen).toHaveBeenCalledWith('waitlist')
    expect(response.status).toHaveBeenCalledWith(200)
    expect(response.json).toHaveBeenCalledWith({ ok: true, count: 42 })
  })

  it('accepts a raw JSON request body', async () => {
    const response = createResponse()
    const store = createStore()

    await handleWaitlist(
      { method: 'POST', body: JSON.stringify({ email: 'person@example.com' }) },
      response,
      store
    )

    expect(store.hsetnx).toHaveBeenCalledWith(
      'waitlist',
      'person@example.com',
      expect.any(String)
    )
    expect(response.status).toHaveBeenCalledWith(200)
  })

  it.each([
    ['a missing body', undefined],
    ['malformed JSON', '{'],
    ['a missing email', {}],
    ['an invalid email', { email: 'not-an-email' }],
    ['a one-character top-level domain', { email: 'person@example.c' }],
    ['an email longer than 254 characters', { email: `${'a'.repeat(243)}@example.com` }]
  ])('rejects %s', async (_name, body) => {
    const response = createResponse()
    const store = createStore()

    await handleWaitlist({ method: 'POST', body }, response, store)

    expect(response.status).toHaveBeenCalledWith(400)
    expect(response.json).toHaveBeenCalledWith({ error: 'invalid_email' })
    expect(store.hsetnx).not.toHaveBeenCalled()
  })

  it('returns the current count when the address already exists', async () => {
    const response = createResponse()
    const store = createStore()
    store.hsetnx.mockResolvedValue(0)
    store.hlen.mockResolvedValue(8)

    await handleWaitlist(
      { method: 'POST', body: { email: 'person@example.com' } },
      response,
      store
    )

    expect(response.json).toHaveBeenCalledWith({ ok: true, count: 8 })
  })

  it('returns a stable error when inserting fails', async () => {
    const response = createResponse()
    const store = createStore()
    store.hsetnx.mockRejectedValue(new Error('offline'))

    await handleWaitlist(
      { method: 'POST', body: { email: 'person@example.com' } },
      response,
      store
    )

    expect(store.hlen).not.toHaveBeenCalled()
    expect(response.status).toHaveBeenCalledWith(500)
    expect(response.json).toHaveBeenCalledWith({ error: 'store_failed' })
  })

  it('returns a stable error when counting fails', async () => {
    const response = createResponse()
    const store = createStore()
    store.hlen.mockRejectedValue(new Error('offline'))

    await handleWaitlist(
      { method: 'POST', body: { email: 'person@example.com' } },
      response,
      store
    )

    expect(response.status).toHaveBeenCalledWith(500)
    expect(response.json).toHaveBeenCalledWith({ error: 'store_failed' })
  })
})
