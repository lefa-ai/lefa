// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelPicker } from './model-picker'

const listModels = vi.fn<() => Promise<readonly { id: string; name: string }[]>>()

beforeEach(() => {
  listModels.mockReset()
  listModels.mockResolvedValue([
    { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5' },
    { id: 'openai/gpt-5.1-codex', name: 'GPT-5.1 Codex' }
  ])
  Object.defineProperty(window, 'lefa', {
    configurable: true,
    value: { models: { list: listModels } }
  })
})

afterEach(cleanup)

describe('ModelPicker', () => {
  it('shows the current model and offers the catalogue', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<ModelPicker model="anthropic/claude-haiku-4.5" onChange={onChange} />)

    const input = screen.getByLabelText('Model') as HTMLInputElement
    expect(input.value).toBe('anthropic/claude-haiku-4.5')
    await waitFor(() => expect(listModels).toHaveBeenCalledOnce())

    await user.click(input)
    await user.clear(input)
    await user.type(input, 'codex')

    const option = await screen.findByText('GPT-5.1 Codex')
    await user.click(option)

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('openai/gpt-5.1-codex'))
  })

  it('still shows the current model when the catalogue cannot be loaded', async () => {
    listModels.mockRejectedValue(new Error('no api key'))
    render(<ModelPicker model="anthropic/claude-opus-5" onChange={vi.fn()} />)

    await waitFor(() => expect(listModels).toHaveBeenCalledOnce())

    expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe(
      'anthropic/claude-opus-5'
    )
  })

  it('stops listening when unmounted before the catalogue arrives', async () => {
    let resolve!: (models: readonly { id: string; name: string }[]) => void
    listModels.mockReturnValue(new Promise((resolvePromise) => (resolve = resolvePromise)))
    render(<ModelPicker model="anthropic/claude-opus-5" onChange={vi.fn()} />)

    cleanup()
    resolve([{ id: 'openai/gpt-5.1-codex', name: 'GPT-5.1 Codex' }])

    await waitFor(() => expect(listModels).toHaveBeenCalledOnce())
  })
})
