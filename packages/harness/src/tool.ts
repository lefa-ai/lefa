import type * as z from 'zod'

export interface Tool<TInputSchema extends z.ZodType = z.ZodType, TOutput = unknown> {
  readonly name: string
  readonly description: string
  readonly inputSchema: TInputSchema
  execute(input: unknown, signal?: AbortSignal): Promise<TOutput>
}

export function defineTool<TInputSchema extends z.ZodType, TOutput>(definition: {
  name: string
  description: string
  inputSchema: TInputSchema
  execute(input: z.infer<TInputSchema>, signal?: AbortSignal): Promise<TOutput>
}): Tool<TInputSchema, TOutput> {
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    async execute(input, signal) {
      return definition.execute(definition.inputSchema.parse(input), signal)
    }
  }
}

export interface ToolRegistry {
  tools: readonly Tool[]
  execute(name: string, input: unknown, signal?: AbortSignal): Promise<unknown>
}

export function createToolRegistry(tools: readonly Tool[]): ToolRegistry {
  const registeredTools = Object.freeze([...tools])
  const toolsByName = new Map<string, Tool>()

  for (const tool of registeredTools) {
    if (toolsByName.has(tool.name)) {
      throw new Error(`Tool is already registered: ${tool.name}`)
    }

    toolsByName.set(tool.name, tool)
  }

  return {
    tools: registeredTools,
    async execute(name, input, signal) {
      const tool = toolsByName.get(name)

      if (!tool) throw new Error(`Unknown tool: ${name}`)

      return tool.execute(input, signal)
    }
  }
}
