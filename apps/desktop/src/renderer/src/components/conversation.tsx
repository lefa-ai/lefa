import {
  getToolName,
  isToolUIPart,
  type DynamicToolUIPart,
  type ToolUIPart,
  type UIMessage
} from 'ai'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Marker } from '@/components/ui/marker'
import { Message, MessageContent } from '@/components/ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '@/components/ui/message-scroller'
import { Markdown } from './markdown'
import { ToolCard, type ToolStatus } from './tool-card'

type Part = UIMessage['parts'][number]

/** A tool part carries its own progress, so nothing has to be matched up. */
const toolStatus = {
  'input-streaming': 'running',
  'input-available': 'running',
  'approval-requested': 'running',
  'approval-responded': 'running',
  'output-available': 'done',
  'output-error': 'error',
  'output-denied': 'error'
} as const satisfies Record<string, ToolStatus>

function format(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'content' in value) return format(value.content)

  return JSON.stringify(value) ?? ''
}

function Tool({ part }: { part: ToolUIPart | DynamicToolUIPart }): React.JSX.Element {
  const output = part.state === 'output-error' ? part.errorText : format(part.output)

  return (
    <ToolCard
      toolName={getToolName(part)}
      input={format(part.input)}
      status={toolStatus[part.state]}
      {...(part.state === 'input-streaming' || part.state === 'input-available' ? {} : { output })}
    />
  )
}

/**
 * The parts worth a row of their own.
 *
 * A reply carries bookkeeping too — where each step began — which says nothing
 * to anyone reading it and would otherwise leave gaps down the transcript.
 */
function shown(message: UIMessage): { part: Part; key: string }[] {
  return message.parts
    .map((part, index) => ({ part, key: `${message.id}-${index}` }))
    .filter(
      ({ part }) =>
        isToolUIPart(part) ||
        ((part.type === 'text' || part.type === 'reasoning') && part.text.length > 0)
    )
}

function Reply({ part, isStreaming }: { part: Part; isStreaming: boolean }): React.JSX.Element {
  if (isToolUIPart(part)) return <Tool part={part} />

  if (part.type === 'reasoning') return <Marker variant="separator">{part.text.trim()}</Marker>

  return (
    <Message>
      <MessageContent>
        <Markdown isStreaming={isStreaming}>{part.type === 'text' ? part.text : ''}</Markdown>
      </MessageContent>
    </Message>
  )
}

function Said({ message }: { message: UIMessage }): React.JSX.Element {
  const text = message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')

  return (
    <Message align="end">
      <Bubble variant="secondary" align="end">
        <BubbleContent className="whitespace-pre-wrap">{text}</BubbleContent>
      </Bubble>
    </Message>
  )
}

/** Said, but not yet asked: it goes to the model when the turn in flight ends. */
function Queued({ text }: { text: string }): React.JSX.Element {
  return (
    <Message align="end">
      <Bubble variant="secondary" align="end" className="opacity-50">
        <BubbleContent className="whitespace-pre-wrap">{text}</BubbleContent>
      </Bubble>
    </Message>
  )
}

export function Conversation({
  messages,
  queued,
  isRunning
}: {
  messages: readonly UIMessage[]
  queued: readonly string[]
  isRunning: boolean
}): React.JSX.Element {
  const lastMessage = messages.length - 1

  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller>
        <MessageScrollerViewport aria-label="Transcript">
          <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-4 px-6 py-6">
            {messages.map((message, index) =>
              message.role === 'user' ? (
                <MessageScrollerItem key={message.id}>
                  <Said message={message} />
                </MessageScrollerItem>
              ) : (
                shown(message).map(({ part, key }, partIndex, parts) => (
                  <MessageScrollerItem key={key}>
                    <Reply
                      part={part}
                      isStreaming={
                        isRunning && index === lastMessage && partIndex === parts.length - 1
                      }
                    />
                  </MessageScrollerItem>
                ))
              )
            )}
            {queued.length > 0 && <Marker variant="separator">Queued</Marker>}
            {queued.map((text, index) => (
              <MessageScrollerItem key={`queued-${index}`}>
                <Queued text={text} />
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton direction="end" size="icon" variant="secondary" />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
