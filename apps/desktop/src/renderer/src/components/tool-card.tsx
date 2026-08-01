import { ChevronRightIcon } from 'lucide-react'
import { useState } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import type { ToolStatus } from '../transcript'

const statusColor: Record<ToolStatus, string> = {
  running: 'bg-primary animate-pulse',
  done: 'bg-success',
  error: 'bg-destructive',
  aborted: 'bg-faint'
}

export function ToolCard({
  toolName,
  input,
  output,
  status
}: {
  toolName: string
  input: string
  output?: string
  status: ToolStatus
}): React.JSX.Element {
  // Open by default: hiding what the agent did would defeat the point of a
  // permissive harness. The output is height-bounded, and noisy calls collapse.
  const [isOpen, setIsOpen] = useState(true)

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      data-status={status}
      className="w-full overflow-hidden rounded-lg border border-border bg-card"
    >
      <CollapsibleTrigger
        disabled={!output}
        className="flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-xs disabled:cursor-default"
      >
        <span className={cn('size-1.5 shrink-0 rounded-full', statusColor[status])} />
        <span className="font-semibold text-primary">{toolName}</span>
        <span className="min-w-0 flex-1 truncate text-faint">{input}</span>
        {output && (
          <ChevronRightIcon
            className={cn(
              'size-3.5 shrink-0 text-faint transition-transform',
              isOpen && 'rotate-90'
            )}
          />
        )}
      </CollapsibleTrigger>
      {output && (
        <CollapsibleContent>
          <pre className="max-h-96 overflow-auto border-t border-border px-3 py-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {output}
          </pre>
        </CollapsibleContent>
      )}
    </Collapsible>
  )
}
