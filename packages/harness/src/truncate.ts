export const MAX_LINES = 2000
export const MAX_BYTES = 50 * 1024

export function splitLines(content: string): string[] {
  if (!content) return ['']

  const lines = content.split('\n')
  if (content.endsWith('\n')) lines.pop()

  return lines
}

export function truncateHead(content: string): string | undefined {
  const lines = splitLines(content)
  if (lines.length <= MAX_LINES && Buffer.byteLength(content) <= MAX_BYTES) return undefined

  const output: string[] = []
  let outputBytes = 0

  for (const line of lines.slice(0, MAX_LINES)) {
    const lineBytes = Buffer.byteLength(line) + (output.length ? 1 : 0)

    if (outputBytes + lineBytes > MAX_BYTES) {
      if (!output.length) throw new Error('The first requested line exceeds the 50 KB limit')
      break
    }

    output.push(line)
    outputBytes += lineBytes
  }

  return output.join('\n')
}

export function truncateTail(content: string): string | undefined {
  const lines = splitLines(content)
  if (lines.length <= MAX_LINES && Buffer.byteLength(content) <= MAX_BYTES) return undefined

  const output: string[] = []
  let outputBytes = 0

  for (let index = lines.length - 1; index >= 0 && output.length < MAX_LINES; index--) {
    const line = lines[index] as string
    const lineBytes = Buffer.byteLength(line) + (output.length ? 1 : 0)

    if (outputBytes + lineBytes > MAX_BYTES) {
      if (!output.length) {
        const buffer = Buffer.from(line)
        let start = buffer.length - MAX_BYTES

        while ((buffer[start] as number) >> 6 === 2) start++
        output.unshift(buffer.subarray(start).toString())
      }
      break
    }

    output.unshift(line)
    outputBytes += lineBytes
  }

  return output.join('\n')
}
