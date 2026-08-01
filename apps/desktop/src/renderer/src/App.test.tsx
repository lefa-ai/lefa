// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../shared/api'
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
const promptAgent = vi.fn<(input: { cwd: string; prompt: string }) => Promise<void>>()
const unsubscribe = vi.fn()
let listeners: Array<(event: AgentEvent) => void> = []

function emit(...events: AgentEvent[]): void {
  act(() => {
    for (const event of events) for (const listener of listeners) listener(event)
  })
}

async function openWorkspace(path = '/tmp/workspace'): Promise<ReturnType<typeof userEvent.setup>> {
  selectDirectory.mockResolvedValue(path)
  const user = userEvent.setup()
  render(<App />)
  await user.click(screen.getByRole('button', { name: 'Open folder' }))
  await screen.findByText(path)

  return user
}

beforeEach(() => {
  selectDirectory.mockReset()
  promptAgent.mockReset()
  promptAgent.mockResolvedValue(undefined)
  unsubscribe.mockReset()
  listeners = []
  Object.defineProperty(window, 'lefa', {
    configurable: true,
    value: {
      agent: {
        prompt: promptAgent,
        onEvent: (listener: (event: AgentEvent) => void) => {
          listeners.push(listener)
          return unsubscribe
        }
      },
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

  it('renders streamed text and tool activity while the run is in flight', async () => {
    const run = deferred<void>()
    promptAgent.mockReturnValue(run.promise)
    const user = await openWorkspace()

    await user.type(screen.getByLabelText('Prompt'), '  list the files  ')
    const runButton = screen.getByRole('button', { name: 'Run' })
    await user.click(runButton)

    expect(promptAgent).toHaveBeenCalledWith({
      cwd: '/tmp/workspace',
      prompt: 'list the files'
    })
    expect(runButton.textContent).toBe('Working…')
    expect((runButton as HTMLButtonElement).disabled).toBe(true)

    emit({ type: 'text', text: 'Let me ' }, { type: 'text', text: 'look.' })
    await screen.findByText('Let me look.')

    emit({
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'bash',
      input: { command: 'ls' }
    })
    const tool = (await screen.findByText('bash')).closest('li')
    expect(tool?.dataset.status).toBe('running')
    expect(screen.getByText('{"command":"ls"}')).toBeTruthy()

    emit({ type: 'tool-result', toolCallId: 'call-1', output: { content: 'README.md' } })
    await screen.findByText('README.md')
    expect(tool?.dataset.status).toBe('done')

    run.resolve()
    await waitFor(() => expect(runButton.textContent).toBe('Run'))
    expect((runButton as HTMLButtonElement).disabled).toBe(false)
  })

  it('marks a failed tool call and reports stream errors', async () => {
    const user = await openWorkspace()

    await user.type(screen.getByLabelText('Prompt'), 'read a file')
    await user.click(screen.getByRole('button', { name: 'Run' }))

    emit(
      { type: 'tool-call', toolCallId: 'call-1', toolName: 'read', input: { path: 'gone.txt' } },
      { type: 'tool-error', toolCallId: 'call-1', message: 'File not found' },
      { type: 'error', message: 'Rate limited' }
    )

    expect((await screen.findByText('read')).closest('li')?.dataset.status).toBe('error')
    expect(screen.getByText('File not found')).toBeTruthy()
    expect((await screen.findByRole('alert')).textContent).toBe('Rate limited')
  })

  it('does not submit an empty prompt', async () => {
    const user = await openWorkspace()

    const textarea = screen.getByLabelText('Prompt')
    await user.type(textarea, '   ')
    fireEvent.submit(textarea.closest('form')!)

    expect(promptAgent).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows and recovers from an agent failure', async () => {
    promptAgent.mockRejectedValueOnce(new Error('agent failed')).mockResolvedValue(undefined)
    const user = await openWorkspace()

    await user.type(screen.getByLabelText('Prompt'), 'run')
    const runButton = screen.getByRole('button', { name: 'Run' })
    await user.click(runButton)

    expect((await screen.findByRole('alert')).textContent).toBe('Unable to run the agent.')
    expect((runButton as HTMLButtonElement).disabled).toBe(false)

    await user.click(runButton)
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('clears the previous transcript on a new run and on a new workspace', async () => {
    selectDirectory.mockResolvedValueOnce('/tmp/one').mockResolvedValueOnce('/tmp/two')
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    await user.type(screen.getByLabelText('Prompt'), 'run')
    await user.click(screen.getByRole('button', { name: 'Run' }))
    emit({ type: 'text', text: 'Finished' })
    await screen.findByText('Finished')

    await user.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(screen.queryByText('Finished')).toBeNull())

    emit({ type: 'text', text: 'Second run' })
    await screen.findByText('Second run')

    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    await screen.findByText('/tmp/two')
    expect(screen.queryByText('Second run')).toBeNull()
  })

  it('stops listening for agent events when unmounted', async () => {
    render(<App />)
    expect(listeners).toHaveLength(1)

    cleanup()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
