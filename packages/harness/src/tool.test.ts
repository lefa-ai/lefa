import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as z from 'zod'
import { createToolRegistry, defineTool } from './tool.ts'

const echoTool = defineTool({
  name: 'echo',
  description: 'Echo a message',
  inputSchema: z.strictObject({ message: z.string() }),
  async execute({ message }) {
    return { message }
  }
})

describe('tool registry', () => {
  it('validates input and executes a registered tool', async () => {
    const registry = createToolRegistry([echoTool])

    assert.deepEqual(await registry.execute('echo', { message: 'hello' }), {
      message: 'hello'
    })
    await assert.rejects(registry.execute('echo', { message: 42 }), z.ZodError)
  })

  it('rejects unknown and duplicate tools', async () => {
    const registry = createToolRegistry([echoTool])

    await assert.rejects(registry.execute('missing', {}), /Unknown tool: missing/)
    assert.throws(() => createToolRegistry([echoTool, echoTool]), /already registered/)
  })
})
