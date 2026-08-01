// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, SessionEvent } from '../../shared/api'
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
const openSession = vi.fn<(cwd: string) => Promise<string>>()
const promptSession = vi.fn<(input: { sessionId: string; prompt: string }) => Promise<void>>()
const abortSession = vi.fn<(sessionId: string) => Promise<void>>()
const unsubscribe = vi.fn()
let listeners: Array<(event: SessionEvent) => void> = []

function emit(...events: AgentEvent[]): void {
  emitFrom('session-1', ...events)
}

function emitFrom(sessionId: string, ...events: AgentEvent[]): void {
  act(() => {
    for (const event of events) for (const listener of listeners) listener({ sessionId, event })
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

async function run(user: ReturnType<typeof userEvent.setup>, text: string): Promise<void> {
  await user.type(screen.getByLabelText('Prompt'), text)
  await user.click(screen.getByRole('button', { name: 'Run' }))
}

beforeEach(() => {
  selectDirectory.mockReset()
  openSession.mockReset()
  openSession.mockResolvedValue('session-1')
  promptSession.mockReset()
  promptSession.mockResolvedValue(undefined)
  abortSession.mockReset()
  abortSession.mockResolvedValue(undefined)
  unsubscribe.mockReset()
  listeners = []
  Object.defineProperty(window, 'lefa', {
    configurable: true,
    value: {
      session: {
        open: openSession,
        prompt: promptSession,
        abort: abortSession,
        onEvent: (listener: (event: SessionEvent) => void) => {
          listeners.push(listener)

          return () => {
            listeners = listeners.filter((current) => current !== listener)
            unsubscribe()
          }
        }
      },
      workspace: { selectDirectory }
    }
  })
})

afterEach(cleanup)

describe('App', () => {
  it('selects a workspace, opens a session, and only then shows the prompt form', async () => {
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

    expect(openSession).toHaveBeenCalledWith('/tmp/workspace')
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
    expect(openSession).not.toHaveBeenCalled()
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

  it('echoes the prompt and renders streamed activity while the run is in flight', async () => {
    const inFlight = deferred<void>()
    promptSession.mockReturnValue(inFlight.promise)
    const user = await openWorkspace()

    await run(user, '  list the files  ')

    expect(promptSession).toHaveBeenCalledWith({
      sessionId: 'session-1',
      prompt: 'list the files'
    })
    expect(screen.getByText('list the files')).toBeTruthy()
    expect((screen.getByLabelText('Prompt') as HTMLTextAreaElement).value).toBe('')
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull()

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

    inFlight.resolve()
    await screen.findByRole('button', { name: 'Run' })
  })

  it('stops a running turn and settles the transcript', async () => {
    const inFlight = deferred<void>()
    promptSession.mockReturnValue(inFlight.promise)
    const user = await openWorkspace()

    await run(user, 'take a while')
    emit({ type: 'tool-call', toolCallId: 'call-1', toolName: 'bash', input: 'sleep 60' })

    await user.click(await screen.findByRole('button', { name: 'Stop' }))
    expect(abortSession).toHaveBeenCalledWith('session-1')

    emit({ type: 'aborted' })
    await screen.findByText('Stopped.')
    expect((await screen.findByText('bash')).closest('li')?.dataset.status).toBe('aborted')

    inFlight.resolve()
    await screen.findByRole('button', { name: 'Run' })
  })

  it('reports a failure to stop the agent', async () => {
    promptSession.mockReturnValue(deferred<void>().promise)
    abortSession.mockRejectedValue(new Error('no such session'))
    const user = await openWorkspace()

    await run(user, 'take a while')
    await user.click(await screen.findByRole('button', { name: 'Stop' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Unable to stop the agent.')
  })

  it('keeps the conversation across turns and clears it for a new workspace', async () => {
    selectDirectory.mockResolvedValueOnce('/tmp/one').mockResolvedValueOnce('/tmp/two')
    openSession.mockResolvedValueOnce('session-1').mockResolvedValueOnce('session-2')
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    await screen.findByText('/tmp/one')
    await run(user, 'list the files')
    emit({ type: 'text', text: 'Two files.' })
    await screen.findByText('Two files.')

    await run(user, 'read the first')
    expect(screen.getByText('list the files')).toBeTruthy()
    expect(screen.getByText('Two files.')).toBeTruthy()
    expect(screen.getByText('read the first')).toBeTruthy()

    emitFrom('session-1', { type: 'text', text: 'It holds the readme.' })
    await screen.findByText('It holds the readme.')

    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    await screen.findByText('/tmp/two')
    expect(screen.queryByText('It holds the readme.')).toBeNull()
    expect(screen.queryByText('list the files')).toBeNull()
  })

  it('ignores events from a session that is no longer on screen', async () => {
    const user = await openWorkspace()

    await run(user, 'list the files')
    emitFrom('session-9', { type: 'text', text: 'From somewhere else' })
    emitFrom('session-9', { type: 'error', message: 'Stale failure' })

    expect(screen.queryByText('From somewhere else')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('marks a failed tool call and reports stream errors', async () => {
    const user = await openWorkspace()

    await run(user, 'read a file')

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

    expect(promptSession).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows and recovers from an agent failure', async () => {
    promptSession.mockRejectedValueOnce(new Error('agent failed')).mockResolvedValue(undefined)
    const user = await openWorkspace()

    await run(user, 'run')

    expect((await screen.findByRole('alert')).textContent).toBe('Unable to run the agent.')

    await run(user, 'again')
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('stops listening for session events when unmounted', async () => {
    render(<App />)
    expect(listeners).toHaveLength(1)

    cleanup()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
