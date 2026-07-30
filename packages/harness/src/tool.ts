import type { Tool } from 'ai'

type ToolContext = Record<string, unknown>

export type ExecutableTool<Input, Output> = Tool<Input, Output, ToolContext> & {
  execute: NonNullable<Tool<Input, Output, ToolContext>['execute']>
}
