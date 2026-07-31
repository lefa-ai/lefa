// @vitest-environment jsdom

import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'

const reactRoot = vi.hoisted(() => ({
  createRoot: vi.fn(),
  render: vi.fn()
}))

vi.mock('react-dom/client', () => ({
  createRoot: reactRoot.createRoot
}))

reactRoot.createRoot.mockReturnValue({ render: reactRoot.render })
document.body.innerHTML = '<div id="root"></div>'
await import('./main')

describe('renderer entrypoint', () => {
  it('mounts the application in StrictMode', () => {
    expect(reactRoot.createRoot).toHaveBeenCalledWith(document.getElementById('root'))
    expect(reactRoot.render).toHaveBeenCalledOnce()
    expect(reactRoot.render.mock.calls[0]?.[0]).toMatchObject({
      type: StrictMode
    })
  })
})
