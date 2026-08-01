import { SquareIcon } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { SessionSummary } from '../../shared/api'
import { Conversation } from './components/conversation'
import { SessionList } from './components/session-list'
import { buildTranscript, reduceTranscript, type TranscriptItem } from './transcript'

function App(): React.JSX.Element {
  const [sessions, setSessions] = useState<readonly SessionSummary[]>([])
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [items, setItems] = useState<readonly TranscriptItem[]>([])
  const [isSelecting, setIsSelecting] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      window.lefa.session.onEvent(({ sessionId: eventSessionId, event }) => {
        // Ignore a session that is no longer on screen while its run drains.
        if (eventSessionId !== sessionId) return

        if (event.type === 'error') setError(event.message)
        else setItems((current) => reduceTranscript(current, event))
      }),
    [sessionId]
  )

  const createSession = async (): Promise<void> => {
    setIsSelecting(true)
    setError(null)

    try {
      const path = await window.lefa.workspace.selectDirectory()

      if (path) {
        setSessionId(await window.lefa.session.open(path))
        setWorkspacePath(path)
        setItems([])
      }
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
      const restored = await window.lefa.session.resume(id)

      setSessionId(restored.id)
      setWorkspacePath(restored.cwd)
      setItems(buildTranscript(restored.events))
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
        setWorkspacePath(null)
        setItems([])
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

    setIsRunning(true)
    setItems((current) => reduceTranscript(current, { type: 'prompt', text }))
    setPrompt('')
    setError(null)

    try {
      await window.lefa.session.prompt({ sessionId, prompt: text })
    } catch {
      setError('Unable to run the agent.')
    } finally {
      setIsRunning(false)
      await refreshSessions()
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
                  <div className="flex justify-end px-1 pb-1">
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
