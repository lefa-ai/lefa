import { code } from '@streamdown/code'
import { Streamdown } from 'streamdown'
import 'streamdown/styles.css'

/**
 * Agent replies arrive a token at a time, so the markdown is usually incomplete:
 * unterminated fences, half-written bold. Streamdown renders those sanely
 * instead of flashing raw syntax.
 */
export function Markdown({
  children,
  isStreaming = false
}: {
  children: string
  isStreaming?: boolean
}): React.JSX.Element {
  return (
    <Streamdown
      className="min-w-0 space-y-3 text-sm leading-relaxed"
      plugins={{ code }}
      shikiTheme={['github-dark-default', 'github-dark-default']}
      isAnimating={isStreaming}
    >
      {children}
    </Streamdown>
  )
}
