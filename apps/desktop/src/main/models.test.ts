import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getAvailableModels: vi.fn() }))

vi.mock('@ai-sdk/gateway', () => ({ gateway: { getAvailableModels: mocks.getAvailableModels } }))

beforeEach(() => {
  vi.resetModules()
  mocks.getAvailableModels.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('model catalogue', () => {
  it('keeps only language models, sorted, and fetches once', async () => {
    mocks.getAvailableModels.mockResolvedValue({
      models: [
        { id: 'openai/gpt-5.1-codex', name: 'GPT-5.1 Codex', modelType: 'language' },
        { id: 'openai/text-embedding-3', name: 'Embedding', modelType: 'embedding' },
        { id: 'anthropic/claude-opus-5', name: 'Claude Opus 5', modelType: 'language' },
        { id: 'google/veo-3', name: 'Veo 3', modelType: 'video' }
      ]
    })

    const { listModels } = await import('./models')

    expect(await listModels()).toEqual([
      { id: 'anthropic/claude-opus-5', name: 'Claude Opus 5' },
      { id: 'openai/gpt-5.1-codex', name: 'GPT-5.1 Codex' }
    ])

    await listModels()
    expect(mocks.getAvailableModels).toHaveBeenCalledOnce()
  })

  it('returns nothing when the gateway is unreachable', async () => {
    mocks.getAvailableModels.mockRejectedValue(new Error('no api key'))

    const { listModels } = await import('./models')

    expect(await listModels()).toEqual([])
    // A failure is not cached, so the next call can still succeed.
    mocks.getAvailableModels.mockResolvedValue({
      models: [{ id: 'anthropic/claude-opus-5', name: 'Claude Opus 5', modelType: 'language' }]
    })
    expect(await listModels()).toEqual([{ id: 'anthropic/claude-opus-5', name: 'Claude Opus 5' }])
  })
})
