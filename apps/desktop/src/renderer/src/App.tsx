import { useEffect, useState, type FormEvent } from 'react'
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
    if (!sessionId || !text) return

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

  return (
    <main>
      <h1>Lefa</h1>
      <button type="button" disabled={isSelecting} onClick={selectWorkspace}>
        {isSelecting ? 'Opening…' : 'Open folder'}
      </button>
      {workspacePath && <code aria-live="polite">{workspacePath}</code>}
      {items.length > 0 && (
        <ol className="transcript" aria-label="Transcript" aria-live="polite">
          {items.map((item, index) =>
            item.kind === 'tool' ? (
              <li key={item.toolCallId} className="tool" data-status={item.status}>
                <p className="tool-call">
                  <span className="tool-name">{item.toolName}</span>
                  <span className="tool-input">{item.input}</span>
                </p>
                {item.output && <pre className="tool-output">{item.output}</pre>}
              </li>
            ) : (
              <li key={index} className={item.kind === 'text' ? 'message' : item.kind}>
                {item.text}
              </li>
            )
          )}
        </ol>
      )}
      {sessionId && (
        <form onSubmit={runAgent}>
          <textarea
            aria-label="Prompt"
            placeholder="Ask Lefa to work in this folder"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
          {isRunning ? (
            <button type="button" onClick={stopAgent}>
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!prompt.trim()}>
              Run
            </button>
          )}
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  )
}

export default App
