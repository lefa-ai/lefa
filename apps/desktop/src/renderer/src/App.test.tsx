// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UIMessage } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionListing, SessionNotification, SessionSnapshot } from '../../shared/api'
import App from './App'

// Streamdown highlights through Shiki asynchronously, which is slow and flaky
// under jsdom. The wrapper is thin; render its text directly instead.
vi.mock('./components/markdown', () => ({
  Markdown: ({ children }: { children: string }) => <div>{children}</div>
}))

function toolStatus(name: string): string | undefined {
  return screen.getByText(name).closest('[data-status]')?.getAttribute('data-status') ?? undefined
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

function said(id: string, text: string, role: UIMessage['role'] = 'assistant'): UIMessage {
  return { id, role, parts: [{ type: 'text', text }] }
}

/** A tool part carries its own progress, so one message covers call and result. */
function used(
  id: string,
  name: string,
  input: unknown,
  state: 'input-available' | 'output-available' | 'output-error',
  extra: { output?: unknown; errorText?: string } = {}
): UIMessage {
  return {
    id,
    role: 'assistant',
    parts: [{ type: `tool-${name}`, toolCallId: `${id}-call`, state, input, ...extra }]
  } as unknown as UIMessage
}

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    id: 'session-1',
    cwd: '/tmp/workspace',
    model: 'anthropic/claude-haiku-4.5',
    status: 'idle',
    messages: [],
    queued: [],
    ...overrides
  }
}

function listing(overrides: Partial<SessionListing> = {}): SessionListing {
  return {
    id: 'session-7',
    cwd: '/tmp/other',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: new Date().toISOString(),
    title: 'Earlier task',
    status: 'idle',
    ...overrides
  }
}

const selectDirectory = vi.fn<() => Promise<string | null>>()
const openSession = vi.fn<(cwd: string) => Promise<SessionSnapshot>>()
const setSessionModel = vi.fn<(input: { sessionId: string; model: string }) => Promise<void>>()
const listModels = vi.fn<() => Promise<readonly { id: string; name: string }[]>>()
const promptSession = vi.fn<(input: { sessionId: string; prompt: string }) => Promise<void>>()
const abortSession = vi.fn<(sessionId: string) => Promise<void>>()
const listSessions = vi.fn<() => Promise<readonly SessionListing[]>>()
const attachSession = vi.fn<(sessionId: string) => Promise<SessionSnapshot>>()
const deleteSession = vi.fn<(sessionId: string) => Promise<void>>()
const unsubscribe = vi.fn()
let listeners: Array<(notification: SessionNotification) => void> = []

function notify(...notifications: SessionNotification[]): void {
  act(() => {
    for (const notification of notifications) {
      for (const listener of listeners) listener(notification)
    }
  })
}

function emit(...messages: UIMessage[]): void {
  emitFrom('session-1', ...messages)
}

function emitFrom(sessionId: string, ...messages: UIMessage[]): void {
  notify(...messages.map((message) => ({ type: 'message' as const, sessionId, message })))
}

function finished(sessionId = 'session-1'): void {
  notify({ type: 'status', sessionId, status: 'idle' })
}

async function openWorkspace(path = '/tmp/workspace'): Promise<ReturnType<typeof userEvent.setup>> {
  selectDirectory.mockResolvedValue(path)
  const user = userEvent.setup()
  render(<App />)
  await user.click(screen.getByRole('button', { name: 'New' }))
  await screen.findByText(path)

  return user
}

async function run(user: ReturnType<typeof userEvent.setup>, text: string): Promise<void> {
  await user.type(screen.getByLabelText('Prompt'), text)
  await user.click(screen.getByRole('button', { name: 'Run' }))
}

/** Types a prompt, then plays back what main sends once the turn is under way. */
async function start(
  user: ReturnType<typeof userEvent.setup>,
  text: string,
  sessionId = 'session-1'
): Promise<void> {
  await run(user, text)
  notify(
    { type: 'status', sessionId, status: 'running' },
    // A distinct id per prompt, as the harness gives them: reusing one would
    // have each turn quietly replace the last.
    { type: 'message', sessionId, message: said(`asked-${text.trim()}`, text.trim(), 'user') }
  )
}

beforeEach(() => {
  selectDirectory.mockReset()
  openSession.mockReset()
  openSession.mockImplementation(async (cwd) => snapshot({ cwd }))
  setSessionModel.mockReset()
  setSessionModel.mockResolvedValue(undefined)
  listModels.mockReset()
  listModels.mockResolvedValue([
    { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5' },
    { id: 'openai/gpt-5.1-codex', name: 'GPT-5.1 Codex' }
  ])
  promptSession.mockReset()
  promptSession.mockResolvedValue(undefined)
  abortSession.mockReset()
  abortSession.mockResolvedValue(undefined)
  listSessions.mockReset()
  listSessions.mockResolvedValue([])
  attachSession.mockReset()
  deleteSession.mockReset()
  deleteSession.mockResolvedValue(undefined)
  unsubscribe.mockReset()
  listeners = []
  Object.defineProperty(window, 'lefa', {
    configurable: true,
    value: {
      session: {
        open: openSession,
        prompt: promptSession,
        abort: abortSession,
        list: listSessions,
        attach: attachSession,
        setModel: setSessionModel,
        delete: deleteSession,
        onNotify: (listener: (notification: SessionNotification) => void) => {
          listeners.push(listener)

          return () => {
            listeners = listeners.filter((current) => current !== listener)
            unsubscribe()
          }
        }
      },
      models: { list: listModels },
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
    const openButton = screen.getByRole('button', { name: 'New' })
    await user.click(openButton)

    expect(openButton.textContent).toBe('Opening…')

    selection.resolve('/tmp/workspace')
    await screen.findByText('/tmp/workspace')

    expect(openSession).toHaveBeenCalledWith('/tmp/workspace')
    expect(screen.getByLabelText('Prompt')).toBeTruthy()
    expect(openButton.textContent).toBe('New')
  })

  it('keeps the current view when folder selection is canceled', async () => {
    selectDirectory.mockResolvedValue(null)
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'New' }))

    expect(openSession).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Prompt')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows and recovers from a folder-picker failure', async () => {
    selectDirectory.mockRejectedValueOnce(new Error('picker failed')).mockResolvedValue('/tmp/good')
    const user = userEvent.setup()
    render(<App />)
    const openButton = screen.getByRole('button', { name: 'New' })

    await user.click(openButton)
    expect((await screen.findByRole('alert')).textContent).toBe('Unable to open the folder picker.')

    await user.click(openButton)
    await screen.findByText('/tmp/good')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('grows a reply in place rather than piling copies up', async () => {
    const user = await openWorkspace()

    await start(user, '  list the files  ')

    expect(promptSession).toHaveBeenCalledWith({ sessionId: 'session-1', prompt: 'list the files' })
    expect(screen.getByText('list the files')).toBeTruthy()
    expect((screen.getByLabelText('Prompt') as HTMLTextAreaElement).value).toBe('')

    // The same message, further along each time.
    emit(said('reply', 'Let me '))
    await screen.findByText('Let me')
    emit(said('reply', 'Let me look.'))
    await screen.findByText('Let me look.')

    expect(screen.queryByText('Let me')).toBeNull()
    finished()
    await screen.findByRole('button', { name: 'Run' })
  })

  it('follows a tool call through to its result', async () => {
    const user = await openWorkspace()
    await start(user, 'list the files')

    emit(used('call', 'bash', { command: 'ls' }, 'input-available'))
    await screen.findByText('bash')
    expect(toolStatus('bash')).toBe('running')
    expect(screen.getByText('{"command":"ls"}')).toBeTruthy()

    emit(
      used('call', 'bash', { command: 'ls' }, 'output-available', {
        output: { content: 'README.md' }
      })
    )
    await screen.findByText('README.md')
    expect(toolStatus('bash')).toBe('done')
  })

  it('marks a failed tool call and reports run errors', async () => {
    const user = await openWorkspace()
    await start(user, 'read a file')

    emit(
      used('call', 'read', { path: 'gone.txt' }, 'output-error', { errorText: 'File not found' })
    )
    expect(toolStatus('read')).toBe('error')
    expect(screen.getByText('File not found')).toBeTruthy()

    notify({
      type: 'error',
      sessionId: 'session-1',
      error: 'No AI Gateway key. Set AI_GATEWAY_API_KEY in apps/desktop/.env.'
    })

    // The provider's own message is the only actionable part; boilerplate hides it.
    expect((await screen.findByRole('alert')).textContent).toBe(
      'No AI Gateway key. Set AI_GATEWAY_API_KEY in apps/desktop/.env.'
    )
  })

  it('stops a running turn', async () => {
    const user = await openWorkspace()

    await start(user, 'take a while')
    emit(used('call', 'bash', { command: 'sleep 60' }, 'input-available'))

    await user.click(await screen.findByRole('button', { name: 'Stop' }))
    expect(abortSession).toHaveBeenCalledWith('session-1')

    finished()
    await screen.findByRole('button', { name: 'Run' })
  })

  it('reports a failure to stop the agent', async () => {
    abortSession.mockRejectedValue(new Error('no such session'))
    const user = await openWorkspace()

    await start(user, 'take a while')
    await user.click(await screen.findByRole('button', { name: 'Stop' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Unable to stop the agent.')
  })

  it('keeps the conversation across turns and clears it for a new workspace', async () => {
    selectDirectory.mockResolvedValueOnce('/tmp/one').mockResolvedValueOnce('/tmp/two')
    openSession
      .mockResolvedValueOnce(snapshot({ id: 'session-1', cwd: '/tmp/one' }))
      .mockResolvedValueOnce(snapshot({ id: 'session-2', cwd: '/tmp/two' }))
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'New' }))
    await screen.findByText('/tmp/one')
    await start(user, 'list the files')
    emit(said('r1', 'Two files.'))
    await screen.findByText('Two files.')
    finished()

    await start(user, 'read the first')
    expect(screen.getByText('list the files')).toBeTruthy()
    expect(screen.getByText('Two files.')).toBeTruthy()
    finished()

    await user.click(screen.getByRole('button', { name: 'New' }))
    await screen.findByText('/tmp/two')
    expect(screen.queryByText('Two files.')).toBeNull()
  })

  it('ignores anything from a session that is no longer on screen', async () => {
    const user = await openWorkspace()

    await start(user, 'list the files')
    finished()
    await screen.findByRole('button', { name: 'Run' })

    emitFrom('session-9', said('elsewhere', 'From somewhere else'))
    notify({ type: 'error', sessionId: 'session-9', error: 'Stale failure' })

    expect(screen.queryByText('From somewhere else')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Run' })).toBeTruthy()
  })

  it('does not submit an empty prompt', async () => {
    const user = await openWorkspace()

    const textarea = screen.getByLabelText('Prompt')
    await user.type(textarea, '   ')
    fireEvent.submit(textarea.closest('form')!)

    expect(promptSession).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows and recovers from a run that was refused outright', async () => {
    promptSession
      .mockRejectedValueOnce(new Error('That session is no longer open.'))
      .mockResolvedValue(undefined)
    const user = await openWorkspace()

    await run(user, 'go')

    expect((await screen.findByRole('alert')).textContent).toBe('That session is no longer open.')

    await start(user, 'again')
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('falls back to a generic message when a refusal carries none', async () => {
    promptSession.mockRejectedValueOnce(new Error('   '))
    const user = await openWorkspace()

    await run(user, 'go')

    expect((await screen.findByRole('alert')).textContent).toBe('Unable to run the agent.')
  })

  it('lists saved sessions and attaches to one with its stored conversation', async () => {
    listSessions.mockResolvedValue([listing({ cwd: '/tmp/other-repo' })])
    attachSession.mockResolvedValue(
      snapshot({
        id: 'session-7',
        cwd: '/tmp/other-repo',
        model: 'openai/gpt-5.1-codex',
        messages: [said('m1', 'What is here?', 'user'), said('m2', 'Two files.')]
      })
    )
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByText('Earlier task'))

    expect(attachSession).toHaveBeenCalledWith('session-7')
    await screen.findByText('/tmp/other-repo')
    expect(screen.getByText('What is here?')).toBeTruthy()
    expect(screen.getByText('Two files.')).toBeTruthy()
  })

  it('picks up a session that is still working, mid-turn', async () => {
    listSessions.mockResolvedValue([listing({ cwd: '/tmp/busy', title: 'Still going' })])
    attachSession.mockResolvedValue(
      snapshot({
        id: 'session-7',
        cwd: '/tmp/busy',
        status: 'running',
        messages: [said('m1', 'Refactor it', 'user'), said('m2', 'Working on')]
      })
    )
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByText('Still going'))

    await screen.findByRole('button', { name: 'Stop' })
    expect(screen.getByText('Working on')).toBeTruthy()

    emitFrom('session-7', said('m2', 'Working on it now.'))
    await screen.findByText('Working on it now.')

    finished('session-7')
    await screen.findByRole('button', { name: 'Run' })
  })

  it('keeps the message that lands in the frame it takes to switch sessions', async () => {
    listSessions.mockResolvedValue([listing({ title: 'Mid-sentence' })])
    const attaching = deferred<SessionSnapshot>()
    attachSession.mockReturnValue(attaching.promise)
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByText('Mid-sentence'))

    // The snapshot lands and the turn's next update follows immediately behind
    // it, before React has had a chance to redraw.
    await act(async () => {
      attaching.resolve(
        snapshot({ id: 'session-7', status: 'running', messages: [said('m1', 'Reading the')] })
      )
      await attaching.promise
      for (const listener of listeners) {
        listener({
          type: 'message',
          sessionId: 'session-7',
          message: said('m1', 'Reading it now.')
        })
      }
    })

    expect(screen.getByText('Reading it now.')).toBeTruthy()
  })

  it('listens once, however many sessions it moves between', async () => {
    listSessions.mockResolvedValue([listing({ title: 'Elsewhere' })])
    attachSession.mockResolvedValue(snapshot({ id: 'session-7', cwd: '/tmp/other' }))
    const user = await openWorkspace()

    await user.click(await screen.findByText('Elsewhere'))
    await screen.findByText('/tmp/other')

    expect(listeners).toHaveLength(1)
  })

  it('shows a session working while you are looking at another one', async () => {
    listSessions.mockResolvedValue([listing({ id: 'session-9', title: 'Off on its own' })])
    await openWorkspace()
    await screen.findByText('Off on its own')

    expect(screen.queryByRole('status', { name: 'Working' })).toBeNull()

    notify({ type: 'status', sessionId: 'session-9', status: 'running' })

    expect(screen.getByRole('status', { name: 'Working' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Run' })).toBeTruthy()

    finished('session-9')
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Working' })).toBeNull())
  })

  it('sends a follow-up into a turn already running instead of making you wait', async () => {
    const user = await openWorkspace()

    await start(user, 'start the work')

    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
    await user.type(screen.getByLabelText('Prompt'), 'then run the tests')
    await user.click(screen.getByRole('button', { name: 'Queue' }))

    expect(promptSession).toHaveBeenLastCalledWith({
      sessionId: 'session-1',
      prompt: 'then run the tests'
    })

    notify({ type: 'queued', sessionId: 'session-1', prompts: ['then run the tests'] })
    await screen.findByText('Queued')
    expect(screen.getByText('then run the tests')).toBeTruthy()

    // The queued turn starts: it leaves the queue and joins the conversation.
    notify({ type: 'queued', sessionId: 'session-1', prompts: [] })
    emit(said('asked-2', 'then run the tests', 'user'))

    await waitFor(() => expect(screen.queryByText('Queued')).toBeNull())
    expect(screen.getByText('then run the tests')).toBeTruthy()
  })

  it('shows what is already queued when attaching mid-turn', async () => {
    listSessions.mockResolvedValue([listing({ title: 'Backed up', status: 'running' })])
    attachSession.mockResolvedValue(
      snapshot({
        id: 'session-7',
        status: 'running',
        messages: [said('m1', 'the first thing', 'user')],
        queued: ['the second thing', 'the third thing']
      })
    )
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByText('Backed up'))

    await screen.findByText('Queued')
    expect(screen.getByText('the second thing')).toBeTruthy()
    expect(screen.getByText('the third thing')).toBeTruthy()
  })

  it('ignores a queue belonging to a session that is not on screen', async () => {
    const user = await openWorkspace()
    await start(user, 'start the work')

    notify({ type: 'queued', sessionId: 'session-9', prompts: ['not ours'] })

    expect(screen.queryByText('Queued')).toBeNull()
  })

  it('refreshes the session list when a run finishes', async () => {
    const user = await openWorkspace()
    await start(user, 'do something')
    listSessions.mockClear()

    finished()

    await waitFor(() => expect(listSessions).toHaveBeenCalled())
  })

  it('deletes a session and clears it when it was on screen', async () => {
    listSessions.mockResolvedValue([
      listing({ id: 'session-1', cwd: '/tmp/workspace', title: 'Current task' })
    ])
    const user = await openWorkspace()
    listSessions.mockResolvedValue([])

    await user.click(screen.getByRole('button', { name: 'Delete Current task' }))

    expect(deleteSession).toHaveBeenCalledWith('session-1')
    await waitFor(() => expect(screen.queryByLabelText('Prompt')).toBeNull())
  })

  it('reports a session that cannot be opened or deleted', async () => {
    listSessions.mockResolvedValue([listing({ title: 'Broken' })])
    attachSession.mockRejectedValue(new Error('gone'))
    deleteSession.mockRejectedValue(new Error('locked'))
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByText('Broken'))
    expect((await screen.findByRole('alert')).textContent).toBe('Unable to open that session.')

    await user.click(screen.getByRole('button', { name: 'Delete Broken' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Unable to delete that session.')
  })

  it('reports a failure to load the session list', async () => {
    listSessions.mockRejectedValue(new Error('disk gone'))
    render(<App />)

    expect((await screen.findByRole('alert')).textContent).toBe('Unable to load saved sessions.')
  })

  it('stops listening for session notifications when unmounted', async () => {
    render(<App />)
    expect(listeners).toHaveLength(1)

    cleanup()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
