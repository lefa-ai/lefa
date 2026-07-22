import { useState, type FormEvent } from 'react'

function App(): React.JSX.Element {
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [isSelecting, setIsSelecting] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectWorkspace = async (): Promise<void> => {
    setIsSelecting(true)
    setError(null)

    try {
      const path = await window.lefa.workspace.selectDirectory()

      if (path) {
        setWorkspacePath(path)
        setAnswer(null)
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
    setAnswer(null)
    setError(null)

    try {
      setAnswer(await window.lefa.agent.prompt({ cwd: workspacePath, prompt: text }))
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
      {answer && <pre aria-live="polite">{answer}</pre>}
      {error && <p role="alert">{error}</p>}
    </main>
  )
}

export default App
