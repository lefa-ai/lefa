import { FolderOpenIcon, SquareIcon } from 'lucide-react'
import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Conversation } from './components/conversation'
import { appendPrompt, reduceTranscript, type TranscriptItem } from './transcript'

function App(): React.JSX.Element {
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [items, setItems] = useState<readonly TranscriptItem[]>([])
  const [isSelecting, setIsSelecting] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(
    () =>
      window.lefa.session.onEvent(({ sessionId: eventSessionId, event }) => {
        // Ignore a previous workspace's run while it drains.
        if (eventSessionId !== sessionId) return

        if (event.type === 'error') setError(event.message)
        else setItems((current) => reduceTranscript(current, event))
      }),
    [sessionId]
  )

  const selectWorkspace = async (): Promise<void> => {
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

  const runAgent = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()

    const text = prompt.trim()
    if (!sessionId || !text || isRunning) return

    setIsRunning(true)
    setItems((current) => appendPrompt(current, text))
    setPrompt('')
    setError(null)

    try {
      await window.lefa.session.prompt({ sessionId, prompt: text })
    } catch {
      setError('Unable to run the agent.')
    } finally {
      setIsRunning(false)
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
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <span className="font-mono text-[10.5px] font-medium tracking-[0.09em] text-muted-foreground uppercase">
          Lefa
        </span>
        {workspacePath && (
          <code aria-live="polite" className="min-w-0 flex-1 truncate font-mono text-xs text-faint">
            {workspacePath}
          </code>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ms-auto"
          disabled={isSelecting}
          onClick={selectWorkspace}
        >
          <FolderOpenIcon />
          {isSelecting ? 'Opening…' : 'Open folder'}
        </Button>
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
          <p className="text-sm text-muted-foreground">Open a folder to start working.</p>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default App
