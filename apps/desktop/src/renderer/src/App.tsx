import { useState } from 'react'

function App(): React.JSX.Element {
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [isSelecting, setIsSelecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectWorkspace = async (): Promise<void> => {
    setIsSelecting(true)
    setError(null)

    try {
      const path = await window.lefa.workspace.selectDirectory()

      if (path) setWorkspacePath(path)
    } catch {
      setError('Unable to open the folder picker.')
    } finally {
      setIsSelecting(false)
    }
  }

  return (
    <main>
      <h1>Lefa</h1>
      <button type="button" disabled={isSelecting} onClick={selectWorkspace}>
        {isSelecting ? 'Opening…' : 'Open folder'}
      </button>
      {workspacePath && <code aria-live="polite">{workspacePath}</code>}
      {error && <p role="alert">{error}</p>}
    </main>
  )
}

export default App
