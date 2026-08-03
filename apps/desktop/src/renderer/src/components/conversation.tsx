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
import type { TranscriptItem } from '../transcript'
import { Markdown } from './markdown'
import { ToolCard } from './tool-card'

function Turn({
  item,
  isStreaming
}: {
  item: TranscriptItem
  isStreaming: boolean
}): React.JSX.Element {
  switch (item.kind) {
    case 'user':
      return (
        <Message align="end">
          <Bubble variant="secondary" align="end">
            <BubbleContent className="whitespace-pre-wrap">{item.text}</BubbleContent>
          </Bubble>
        </Message>
      )
    case 'text':
      return (
        <Message>
          <MessageContent>
            <Markdown isStreaming={isStreaming}>{item.text}</Markdown>
          </MessageContent>
        </Message>
      )
    case 'notice':
      return <Marker variant="separator">{item.text}</Marker>
    case 'tool':
      return (
        <ToolCard
          toolName={item.toolName}
          input={item.input}
          status={item.status}
          {...(item.output === undefined ? {} : { output: item.output })}
        />
      )
  }
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
  items,
  queued,
  isRunning
}: {
  items: readonly TranscriptItem[]
  queued: readonly string[]
  isRunning: boolean
}): React.JSX.Element {
  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller>
        <MessageScrollerViewport aria-label="Transcript">
          <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-4 px-6 py-6">
            {items.map((item, index) => (
              <MessageScrollerItem key={item.kind === 'tool' ? item.toolCallId : index}>
                <Turn item={item} isStreaming={isRunning && index === items.length - 1} />
              </MessageScrollerItem>
            ))}
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
