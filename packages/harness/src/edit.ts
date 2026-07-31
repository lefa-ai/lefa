import { readFile, writeFile } from 'node:fs/promises'
import { tool } from 'ai'
import * as z from 'zod'
import { resolvePath } from './path.ts'
import type { ExecutableTool } from './tool.ts'

const editInputSchema = z.strictObject({
  path: z.string().min(1).describe('Relative or absolute path'),
  oldText: z.string().min(1).describe('Exact text to replace; must be unique'),
  newText: z.string().describe('Replacement text')
})

export type EditInput = z.infer<typeof editInputSchema>

export interface EditOutput {
  content: string
}

export type EditTool = ExecutableTool<EditInput, EditOutput>

async function editFile(cwd: string, { path, oldText, newText }: EditInput): Promise<EditOutput> {
  const absolutePath = resolvePath(cwd, path)
  const content = await readFile(absolutePath, 'utf8')
  const match = content.indexOf(oldText)

  if (match === -1) throw new Error(`Could not find oldText in ${path}`)
  if (content.indexOf(oldText, match + 1) !== -1) {
    throw new Error(`oldText must be unique in ${path}`)
  }

  const updated = content.slice(0, match) + newText + content.slice(match + oldText.length)
  await writeFile(absolutePath, updated, 'utf8')

  return { content: `Successfully edited ${path}` }
}

export function createEditTool(cwd: string): EditTool {
  return tool({
    description: 'Edit a file by replacing one unique, exact block of text.',
    inputSchema: editInputSchema,
    strict: true,
    execute: (input) => editFile(cwd, input),
    toModelOutput: ({ output }) => ({ type: 'text', value: output.content })
  })
}
