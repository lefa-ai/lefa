import { spawn } from 'node:child_process'
import { addAbortListener } from 'node:events'
import { PassThrough, type Readable } from 'node:stream'
import { OutputCapture, type CapturedOutput } from './bash-output.ts'

const TERMINATION_GRACE = 500
const OUTPUT_IDLE_TIME = 100
const OUTPUT_DRAIN_TIME = 2000
const COMMAND_TIMEOUT = 120_000

export interface BashProcessOptions {
  command: string
  cwd: string
  abortSignal?: AbortSignal
}

export type BashProcessResult =
  | {
      status: 'exited'
      exitCode: number
      output: CapturedOutput
    }
  | {
      status: 'signaled'
      signal: NodeJS.Signals
      output: CapturedOutput
    }
  | {
      status: 'timed-out'
      output: CapturedOutput
    }

type ProcessEvent =
  | {
      type: 'exit'
      exitCode: number | null
      signal: NodeJS.Signals | null
    }
  | {
      type: 'process-error'
      error: Error
    }

type CaptureEvent =
  | {
      type: 'captured'
      output: CapturedOutput
    }
  | {
      type: 'capture-error'
      error: unknown
    }

type AbortEvent = 'aborted'
type TimeoutEvent = 'timed-out'
type DrainLimitEvent = 'drain-limit'

interface MergedOutput {
  stream: PassThrough
  stop: () => void
}

export async function runBashProcess(options: BashProcessOptions): Promise<BashProcessResult> {
  const { abortSignal } = options

  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    throw new Error('The bash tool currently supports macOS and Linux')
  }

  abortSignal?.throwIfAborted()
  const abort = createAbortEvent(abortSignal)

  try {
    abortSignal?.throwIfAborted()
    return await runBashProcessWithAbort(options, abort.promise)
  } finally {
    abort.dispose()
  }
}

async function runBashProcessWithAbort(
  { command, cwd, abortSignal }: BashProcessOptions,
  abort: Promise<AbortEvent>
): Promise<BashProcessResult> {
  const child = spawn('bash', ['-c', command], {
    cwd,
    detached: true,
    env: {
      ...process.env,
      NO_COLOR: '1',
      TERM: 'dumb',
      PAGER: 'cat',
      GIT_PAGER: 'cat',
      GH_PAGER: 'cat'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const mergedOutput = mergeOutput(child.stdout, child.stderr)
  const capture = new OutputCapture()
  let lastOutputAt = Date.now()

  const captureEvent: Promise<CaptureEvent> = captureOutput(mergedOutput.stream, capture, () => {
    lastOutputAt = Date.now()
  }).then(
    (output) => ({ type: 'captured', output }),
    (error: unknown) => ({ type: 'capture-error', error })
  )
  const captureFailure = new Promise<Extract<CaptureEvent, { type: 'capture-error' }>>(
    (resolve) => {
      void captureEvent.then((event) => {
        if (event.type === 'capture-error') resolve(event)
      })
    }
  )
  const processEvent = waitForProcess(child)
  let timeoutHandle: NodeJS.Timeout | undefined
  const timeout = new Promise<TimeoutEvent>((resolve) => {
    timeoutHandle = setTimeout(() => resolve('timed-out'), COMMAND_TIMEOUT)
  })

  try {
    const first = await Promise.race([processEvent, captureFailure, abort, timeout])

    if (first === 'aborted') {
      await terminateAndDrain(child.pid, processEvent, captureEvent, mergedOutput)
      throw abortReason(abortSignal)
    }

    if (first === 'timed-out') {
      const captured = await terminateAndDrain(child.pid, processEvent, captureEvent, mergedOutput)
      if (captured.type === 'capture-error') throw captured.error

      return { status: 'timed-out', output: captured.output }
    }

    if (first.type === 'process-error') {
      mergedOutput.stop()
      await captureEvent
      throw first.error
    }

    if (first.type === 'capture-error') {
      await terminateAndDrain(child.pid, processEvent, captureEvent, mergedOutput)
      throw first.error
    }

    clearTimeout(timeoutHandle)
    timeoutHandle = undefined
    lastOutputAt = Date.now()

    const drained = await waitForPostExitDrain(captureEvent, abort, () => lastOutputAt)

    if (drained === 'aborted') {
      await terminateAndDrain(child.pid, processEvent, captureEvent, mergedOutput)
      throw abortReason(abortSignal)
    }

    await terminateProcessGroup(child.pid)
    if (drained === 'drain-limit') mergedOutput.stop()

    const captured = drained === 'drain-limit' ? await captureEvent : drained

    if (captured.type === 'capture-error') throw captured.error
    if (first.exitCode !== null) {
      return {
        status: 'exited',
        exitCode: first.exitCode,
        output: captured.output
      }
    }
    if (first.signal !== null) {
      return {
        status: 'signaled',
        signal: first.signal,
        output: captured.output
      }
    }

    throw new Error('Bash exited without an exit code or signal')
  } finally {
    clearTimeout(timeoutHandle)
  }
}

function mergeOutput(stdout: Readable, stderr: Readable): MergedOutput {
  const stream = new PassThrough()
  const sources = [stdout, stderr]
  const completed = new Set<Readable>()

  const complete = (source: Readable) => {
    if (completed.has(source)) return
    completed.add(source)
    if (completed.size === sources.length && !stream.writableEnded) stream.end()
  }

  for (const source of sources) {
    source.once('end', () => complete(source))
    source.once('close', () => complete(source))
    source.once('error', (error) => stream.destroy(error))
    source.pipe(stream, { end: false })
  }

  return {
    stream,
    stop: () => {
      for (const source of sources) {
        source.unpipe(stream)
        source.destroy()
      }
      if (!stream.writableEnded && !stream.destroyed) stream.end()
    }
  }
}

async function captureOutput(
  stream: Readable,
  capture: OutputCapture,
  onOutput: () => void
): Promise<CapturedOutput> {
  try {
    for await (const chunk of stream) {
      onOutput()
      await capture.write(chunk as Buffer)
      onOutput()
    }

    return await capture.finish()
  } catch (error) {
    await capture.close().catch(() => undefined)
    throw error
  }
}

function waitForProcess(child: ReturnType<typeof spawn>): Promise<ProcessEvent> {
  return new Promise((resolve) => {
    child.once('error', (error) => resolve({ type: 'process-error', error }))
    child.once('exit', (exitCode, signal) => resolve({ type: 'exit', exitCode, signal }))
  })
}

function createAbortEvent(signal: AbortSignal | undefined): {
  promise: Promise<AbortEvent>
  dispose: () => void
} {
  const { promise, resolve } = Promise.withResolvers<AbortEvent>()
  const listener = signal ? addAbortListener(signal, () => resolve('aborted')) : undefined

  return {
    promise,
    dispose: () => listener?.[Symbol.dispose]()
  }
}

async function waitForPostExitDrain(
  capture: Promise<CaptureEvent>,
  abort: Promise<AbortEvent>,
  getLastOutputAt: () => number
): Promise<CaptureEvent | AbortEvent | DrainLimitEvent> {
  const deadline = Date.now() + OUTPUT_DRAIN_TIME

  while (true) {
    const now = Date.now()
    const waitTime = Math.min(deadline - now, OUTPUT_IDLE_TIME - (now - getLastOutputAt()))

    if (waitTime <= 0) return 'drain-limit'

    const event = await raceWithDelay<CaptureEvent | AbortEvent>([capture, abort], waitTime)
    if (event !== undefined) return event
  }
}

async function terminateAndDrain(
  pid: number | undefined,
  processEvent: Promise<ProcessEvent>,
  captureEvent: Promise<CaptureEvent>,
  mergedOutput: MergedOutput
): Promise<CaptureEvent> {
  await terminateProcessGroup(pid)

  const exited = await raceWithDelay([processEvent], OUTPUT_DRAIN_TIME)
  if (exited === undefined) {
    mergedOutput.stop()
    throw new Error('Bash did not exit after SIGKILL')
  }

  const captured = await raceWithDelay([captureEvent], OUTPUT_DRAIN_TIME)
  if (captured !== undefined) return captured

  mergedOutput.stop()
  return captureEvent
}

async function terminateProcessGroup(pid: number | undefined): Promise<void> {
  if (pid === undefined || !signalProcessGroup(pid, 'SIGTERM')) return

  await delay(TERMINATION_GRACE)
  signalProcessGroup(pid, 'SIGKILL')
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}

function abortReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new DOMException('The operation was aborted', 'AbortError')
}

async function raceWithDelay<T>(
  promises: readonly Promise<T>[],
  milliseconds: number
): Promise<T | undefined> {
  let timeoutHandle: NodeJS.Timeout | undefined
  const timeout = new Promise<undefined>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(undefined), milliseconds)
  })

  try {
    return await Promise.race([...promises, timeout])
  } finally {
    clearTimeout(timeoutHandle)
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
