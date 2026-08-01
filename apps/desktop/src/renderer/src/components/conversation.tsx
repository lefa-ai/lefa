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

export function Conversation({
  items,
  isRunning
}: {
  items: readonly TranscriptItem[]
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
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton direction="end" size="icon" variant="secondary" />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
