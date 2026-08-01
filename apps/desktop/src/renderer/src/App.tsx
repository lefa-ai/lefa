import { useEffect, useState, type FormEvent } from 'react'
import { reduceTranscript, type TranscriptItem } from './transcript'

function App(): React.JSX.Element {
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [items, setItems] = useState<readonly TranscriptItem[]>([])
  const [isSelecting, setIsSelecting] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(
    () =>
      window.lefa.agent.onEvent((event) => {
        if (event.type === 'error') setError(event.message)
        else setItems((current) => reduceTranscript(current, event))
      }),
    []
  )

  const selectWorkspace = async (): Promise<void> => {
    setIsSelecting(true)
    setError(null)

    try {
      const path = await window.lefa.workspace.selectDirectory()

      if (path) {
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
    if (!workspacePath || !text) return

    setIsRunning(true)
    setItems([])
    setError(null)

    try {
      await window.lefa.agent.prompt({ cwd: workspacePath, prompt: text })
    } catch {
      setError('Unable to run the agent.')
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <main>
      <h1>Lefa</h1>
      <button type="button" disabled={isSelecting} onClick={selectWorkspace}>
        {isSelecting ? 'Opening…' : 'Open folder'}
      </button>
      {workspacePath && <code aria-live="polite">{workspacePath}</code>}
      {workspacePath && (
        <form onSubmit={runAgent}>
          <textarea
            aria-label="Prompt"
            placeholder="Ask Lefa to work in this folder"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <button type="submit" disabled={isRunning || !prompt.trim()}>
            {isRunning ? 'Working…' : 'Run'}
          </button>
        </form>
      )}
      {items.length > 0 && (
        <ol className="transcript" aria-label="Transcript" aria-live="polite">
          {items.map((item, index) =>
            item.kind === 'text' ? (
              <li key={index} className="message">
                {item.text}
              </li>
            ) : (
              <li key={item.toolCallId} className="tool" data-status={item.status}>
                <p className="tool-call">
                  <span className="tool-name">{item.toolName}</span>
                  <span className="tool-input">{item.input}</span>
                </p>
                {item.output && <pre className="tool-output">{item.output}</pre>}
              </li>
            )
          )}
        </ol>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  )
}

export default App
