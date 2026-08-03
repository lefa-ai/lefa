import { PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { relativeTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { SessionListing } from '../../../shared/api'

function workspaceName(cwd: string): string {
  return cwd.split('/').filter(Boolean).at(-1) ?? cwd
}

/** Lime, breathing: the one thing in the list that is happening right now. */
function Working(): React.JSX.Element {
  return (
    <span
      role="status"
      aria-label="Working"
      className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary"
    />
  )
}

export function SessionList({
  sessions,
  activeId,
  isCreating,
  onCreate,
  onSelect,
  onDelete
}: {
  sessions: readonly SessionListing[]
  activeId: string | null
  isCreating: boolean
  onCreate: () => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}): React.JSX.Element {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="font-mono text-[10.5px] font-medium tracking-[0.09em] text-muted-foreground uppercase">
          Lefa
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ms-auto"
          disabled={isCreating}
          onClick={onCreate}
        >
          <PlusIcon />
          {isCreating ? 'Opening…' : 'New'}
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <nav aria-label="Sessions" className="flex flex-col gap-0.5 p-2">
          {sessions.length === 0 ? (
            <p className="px-2 py-3 text-xs text-faint">No sessions yet.</p>
          ) : (
            sessions.map((session) => (
              <div key={session.id} className="group/session relative">
                <button
                  type="button"
                  aria-current={session.id === activeId}
                  onClick={() => onSelect(session.id)}
                  className={cn(
                    'w-full rounded-md px-2 py-2 pe-8 text-left transition-colors hover:bg-secondary',
                    session.id === activeId && 'bg-secondary'
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {session.title || 'Untitled'}
                    </span>
                    {session.status === 'running' && <Working />}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[10.5px] text-faint">
                    <span className="truncate">{workspaceName(session.cwd)}</span>
                    <span aria-hidden>·</span>
                    <span className="shrink-0">{relativeTime(session.updatedAt)}</span>
                  </span>
                </button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Delete ${session.title || 'Untitled'}`}
                  onClick={() => onDelete(session.id)}
                  className="absolute end-1 top-1.5 size-6 opacity-0 group-hover/session:opacity-100 focus-visible:opacity-100"
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
            ))
          )}
        </nav>
      </ScrollArea>
    </aside>
  )
}
