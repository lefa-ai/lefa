import { SquareIcon } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { RunStatus, SessionSnapshot, SessionSummary } from '../../shared/api'
import { Conversation } from './components/conversation'
import { ModelPicker } from './components/model-picker'
import { SessionList } from './components/session-list'
import { buildTranscript, reduceTranscript, type TranscriptItem } from './transcript'

function App(): React.JSX.Element {
  const [sessions, setSessions] = useState<readonly SessionSummary[]>([])
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [items, setItems] = useState<readonly TranscriptItem[]>([])
  const [isSelecting, setIsSelecting] = useState(false)
  const [status, setStatus] = useState<RunStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const isRunning = status === 'running'

  const refreshSessions = useCallback(async (): Promise<void> => {
    try {
      setSessions(await window.lefa.session.list())
    } catch {
      setError('Unable to load saved sessions.')
    }
  }, [])

  useEffect(() => {
    let listening = true

    void (async () => {
      try {
        const saved = await window.lefa.session.list()

        if (listening) setSessions(saved)
      } catch {
        if (listening) setError('Unable to load saved sessions.')
      }
    })()

    return () => {
      listening = false
    }
  }, [])

  useEffect(
    () =>
      window.lefa.session.onNotify((notification) => {
        // Ignore a session that is no longer on screen while its run continues.
        if (notification.sessionId !== sessionId) return

        if (notification.type === 'status') {
          setStatus(notification.status)
          // A finished turn is a turn worth listing.
          if (notification.status === 'idle') void refreshSessions()

          return
        }

        if (notification.event.type === 'error') setError(notification.event.message)
        else setItems((current) => reduceTranscript(current, notification.event))
      }),
    [sessionId, refreshSessions]
  )

  const showSession = (snapshot: SessionSnapshot): void => {
    setSessionId(snapshot.id)
    setModel(snapshot.model)
    setWorkspacePath(snapshot.cwd)
    setItems(buildTranscript(snapshot.events))
    setStatus(snapshot.status)
  }

  const createSession = async (): Promise<void> => {
    setIsSelecting(true)
    setError(null)

    try {
      const path = await window.lefa.workspace.selectDirectory()

      if (path) showSession(await window.lefa.session.open(path))
    } catch {
      setError('Unable to open the folder picker.')
    } finally {
      setIsSelecting(false)
    }
  }

  const selectSession = async (id: string): Promise<void> => {
    if (id === sessionId) return
    setError(null)

    try {
      showSession(await window.lefa.session.attach(id))
    } catch {
      setError('Unable to open that session.')
    }
  }

  const deleteSession = async (id: string): Promise<void> => {
    setError(null)

    try {
      await window.lefa.session.delete(id)

      if (id === sessionId) {
        setSessionId(null)
        setModel(null)
        setWorkspacePath(null)
        setItems([])
        setStatus('idle')
      }

      await refreshSessions()
    } catch {
      setError('Unable to delete that session.')
    }
  }

  const runAgent = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()

    const text = prompt.trim()
    if (!sessionId || !text || isRunning) return

    setPrompt('')
    setError(null)

    try {
      // The prompt itself comes back as an event, so every watcher sees it.
      await window.lefa.session.prompt({ sessionId, prompt: text })
    } catch (failure) {
      // Provider failures carry the only useful detail — a missing key, an
      // unavailable model — so show what came back rather than boilerplate.
      const message = failure instanceof Error ? failure.message.trim() : ''

      setError(message || 'Unable to run the agent.')
    }
  }

  const stopAgent = async (): Promise<void> => {
    if (!sessionId) return

    try {
      await window.lefa.session.abort(sessionId)
    } catch {
      setError('Unable to stop the agent.')
    }
  }

  const changeModel = async (next: string): Promise<void> => {
    if (!sessionId) return

    const previous = model
    setModel(next)

    try {
      await window.lefa.session.setModel({ sessionId, model: next })
    } catch {
      setModel(previous)
      setError('Unable to switch model.')
    }
  }

  const submitOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey) return

    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  return (
    <div className="flex h-full">
      <SessionList
        sessions={sessions}
        activeId={sessionId}
        isCreating={isSelecting}
        onCreate={createSession}
        onSelect={selectSession}
        onDelete={deleteSession}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
          {workspacePath && (
            <code aria-live="polite" className="min-w-0 truncate font-mono text-xs text-faint">
              {workspacePath}
            </code>
          )}
        </header>

        {sessionId ? (
          <>
            <div className="min-h-0 flex-1">
              <Conversation items={items} isRunning={isRunning} />
            </div>

            <div className="shrink-0 px-6 pb-6">
              <form onSubmit={runAgent} className="mx-auto w-full max-w-3xl">
                <div className="rounded-xl border border-border bg-card p-2 focus-within:border-ring">
                  <Textarea
                    aria-label="Prompt"
                    placeholder="Ask Lefa to work in this folder"
                    value={prompt}
                    rows={2}
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={submitOnEnter}
                    className="max-h-56 min-h-0 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
                  />
                  <div className="flex items-center justify-between gap-2 px-1 pb-1">
                    {model && <ModelPicker model={model} onChange={changeModel} />}
                    {isRunning ? (
                      <Button type="button" size="sm" variant="secondary" onClick={stopAgent}>
                        <SquareIcon />
                        Stop
                      </Button>
                    ) : (
                      <Button type="submit" size="sm" disabled={!prompt.trim()}>
                        Run
                      </Button>
                    )}
                  </div>
                </div>
              </form>
              {error && (
                <p role="alert" className="mx-auto mt-2 w-full max-w-3xl text-xs text-destructive">
                  {error}
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-muted-foreground">
              Open a folder to start working, or pick a session.
            </p>
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default App
