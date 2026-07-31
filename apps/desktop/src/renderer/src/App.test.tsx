// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

const selectDirectory = vi.fn<() => Promise<string | null>>()
const promptAgent = vi.fn<(input: { cwd: string; prompt: string }) => Promise<string>>()

beforeEach(() => {
  selectDirectory.mockReset()
  promptAgent.mockReset()
  Object.defineProperty(window, 'lefa', {
    configurable: true,
    value: {
      agent: { prompt: promptAgent },
      workspace: { selectDirectory }
    }
  })
})

afterEach(cleanup)

describe('App', () => {
  it('selects a workspace and only then shows the prompt form', async () => {
    const selection = deferred<string | null>()
    selectDirectory.mockReturnValue(selection.promise)
    const user = userEvent.setup()
    render(<App />)

    expect(screen.queryByLabelText('Prompt')).toBeNull()
    const openButton = screen.getByRole('button', { name: 'Open folder' })
    await user.click(openButton)

    expect(openButton.textContent).toBe('Opening…')
    expect((openButton as HTMLButtonElement).disabled).toBe(true)

    selection.resolve('/tmp/workspace')
    await screen.findByText('/tmp/workspace')

    expect(screen.getByLabelText('Prompt')).toBeTruthy()
    expect(openButton.textContent).toBe('Open folder')
    expect((openButton as HTMLButtonElement).disabled).toBe(false)
  })

  it('keeps the current view when folder selection is canceled', async () => {
    selectDirectory.mockResolvedValue(null)
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Open folder' }))

    expect(selectDirectory).toHaveBeenCalledOnce()
    expect(screen.queryByLabelText('Prompt')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows and recovers from a folder-picker failure', async () => {
    selectDirectory.mockRejectedValueOnce(new Error('picker failed')).mockResolvedValue('/tmp/good')
    const user = userEvent.setup()
    render(<App />)
    const openButton = screen.getByRole('button', { name: 'Open folder' })

    await user.click(openButton)
    expect((await screen.findByRole('alert')).textContent).toBe('Unable to open the folder picker.')
    expect((openButton as HTMLButtonElement).disabled).toBe(false)

    await user.click(openButton)
    await screen.findByText('/tmp/good')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('trims the prompt, shows progress, and renders the answer', async () => {
    selectDirectory.mockResolvedValue('/tmp/workspace')
    const response = deferred<string>()
    promptAgent.mockReturnValue(response.promise)
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    await user.type(screen.getByLabelText('Prompt'), '  explain this  ')
    const runButton = screen.getByRole('button', { name: 'Run' })
    await user.click(runButton)

    expect(promptAgent).toHaveBeenCalledWith({
      cwd: '/tmp/workspace',
      prompt: 'explain this'
    })
    expect(runButton.textContent).toBe('Working…')
    expect((runButton as HTMLButtonElement).disabled).toBe(true)

    response.resolve('The answer')
    await screen.findByText('The answer')

    expect(runButton.textContent).toBe('Run')
    expect((runButton as HTMLButtonElement).disabled).toBe(false)
  })

  it('does not submit an empty prompt', async () => {
    selectDirectory.mockResolvedValue('/tmp/workspace')
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    const textarea = screen.getByLabelText('Prompt')
    await user.type(textarea, '   ')
    const form = textarea.closest('form')
    fireEvent.submit(form!)

    expect(promptAgent).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows and recovers from an agent failure', async () => {
    selectDirectory.mockResolvedValue('/tmp/workspace')
    promptAgent.mockRejectedValueOnce(new Error('agent failed')).mockResolvedValue('Recovered')
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    await user.type(screen.getByLabelText('Prompt'), 'run')
    const runButton = screen.getByRole('button', { name: 'Run' })
    await user.click(runButton)

    expect((await screen.findByRole('alert')).textContent).toBe('Unable to run the agent.')
    expect((runButton as HTMLButtonElement).disabled).toBe(false)

    await user.click(runButton)
    await screen.findByText('Recovered')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('clears the previous answer when a new workspace is selected', async () => {
    selectDirectory.mockResolvedValueOnce('/tmp/one').mockResolvedValueOnce('/tmp/two')
    promptAgent.mockResolvedValue('Finished')
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    await user.type(screen.getByLabelText('Prompt'), 'run')
    await user.click(screen.getByRole('button', { name: 'Run' }))
    await screen.findByText('Finished')

    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    await waitFor(() => expect(screen.getByText('/tmp/two')).toBeTruthy())

    expect(screen.queryByText('Finished')).toBeNull()
  })
})
