import { gateway } from '@ai-sdk/gateway'
import type { ModelSummary } from '../shared/api'

let cached: readonly ModelSummary[] | undefined

/**
 * The Gateway's language models, fetched once per app run.
 *
 * A failure here — no API key, no network — returns nothing rather than
 * throwing: the catalogue is a convenience, and losing it must not stop you
 * working with the model you already have.
 */
export async function listModels(): Promise<readonly ModelSummary[]> {
  if (cached) return cached

  try {
    const { models } = await gateway.getAvailableModels()
    const available = models
      .filter((model) => model.modelType === 'language')
      .map((model) => ({ id: model.id, name: model.name }))
      .sort((first, second) => first.id.localeCompare(second.id))

    cached = available

    return available
  } catch {
    return []
  }
}
