import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { asSchema } from 'ai'
import { runBashProcess } from './bash-process.ts'
import { createBashTool, type BashOutput } from './bash.ts'

interface RawBashInput {
  command: string
}

async function executeBash(
  cwd: string,
  input: RawBashInput,
  abortSignal?: AbortSignal
): Promise<BashOutput> {
  const bash = createBashTool(cwd)
  const validation = await asSchema(bash.inputSchema).validate?.(input)

  if (validation === undefined) throw new Error('The bash tool has no input validator')
  if (!validation.success) throw validation.error

  const output = await bash.execute(validation.value, {
    toolCallId: 'test-bash',
    messages: [],
    context: {},
    ...(abortSignal === undefined ? {} : { abortSignal })
  })

  if (Symbol.asyncIterator in output) {
    throw new Error('The bash tool unexpectedly returned a stream')
  }

  return output
}

async function withTempDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'lefa-bash-'))

  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 2000

  while (processExists(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }

  assert.equal(processExists(pid), false, `Process ${pid} is still running`)
}

describe('bash tool', { skip: process.platform === 'win32' }, () => {
  it('defines the model input and text output', async () => {
    const bash = createBashTool('.')
    const schema = asSchema(bash.inputSchema)

    assert.deepEqual(await schema.validate?.({ command: 'pwd' }), {
      success: true,
      value: { command: 'pwd' }
    })
    assert.ok(bash.toModelOutput)
    assert.deepEqual(
      await bash.toModelOutput({
        toolCallId: 'test-bash',
        input: { command: 'pwd' },
        output: { content: 'output' }
      }),
      { type: 'text', value: 'output' }
    )
  })

  it('returns a message for successful commands without output', async () => {
    assert.deepEqual(await executeBash(process.cwd(), { command: ':' }), {
      content: 'Command completed successfully.'
    })
  })

  it('returns combined output and a nonzero exit code without throwing', async () => {
    const result = await executeBash(process.cwd(), {
      command:
        "printf 'one\\n'; sleep 0.02; printf 'two\\n' >&2; sleep 0.02; printf 'three\\n'; exit 7"
    })

    assert.equal(result.content, 'one\ntwo\nthree\n\nCommand exited with code 7.')
  })

  it('passes caller cancellation through the tool and cleans up the process', async () => {
    await withTempDirectory(async (directory) => {
      const pidPath = join(directory, 'pid')
      const controller = new AbortController()
      const execution = executeBash(
        directory,
        {
          command: `echo $$ > ${shellQuote(pidPath)}; trap '' TERM; while true; do sleep 1; done`
        },
        controller.signal
      )

      while (true) {
        try {
          await readFile(pidPath)
          break
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
      }

      controller.abort()
      await assert.rejects(execution, { name: 'AbortError' })
      await waitForProcessExit(Number(await readFile(pidPath, 'utf8')))
    })
  })

  it('does not spawn when the caller is already cancelled', async () => {
    await withTempDirectory(async (directory) => {
      const outputPath = join(directory, 'created')
      const controller = new AbortController()
      controller.abort()

      await assert.rejects(
        executeBash(directory, { command: `touch ${shellQuote(outputPath)}` }, controller.signal),
        { name: 'AbortError' }
      )
      await assert.rejects(readFile(outputPath))
    })
  })

  it('captures output written shortly after the shell exits', async () => {
    const result = await runBashProcess({
      command: 'sleep 0.15; (sleep 0.05; echo late) &',
      cwd: process.cwd()
    })

    assert.equal(result.status, 'exited')
    assert.equal(result.output.preview, 'late\n')
  })

  it('does not leave background descendants running', async () => {
    const result = await runBashProcess({
      command: 'sleep 30 & echo $!',
      cwd: process.cwd()
    })

    assert.equal(result.status, 'exited')
    await waitForProcessExit(Number(result.output.preview.trim()))
  })

  it('kills background descendants that ignore SIGTERM after Bash exits', async () => {
    await withTempDirectory(async (directory) => {
      const pidPath = join(directory, 'pid')
      const startedAt = Date.now()
      const result = await runBashProcess({
        command: `(trap '' TERM; exec >/dev/null 2>&1; while true; do sleep 1; done) & echo $! > ${shellQuote(pidPath)}`,
        cwd: directory
      })

      assert.equal(result.status, 'exited')
      assert.ok(Date.now() - startedAt < 4000)
      await waitForProcessExit(Number(await readFile(pidPath, 'utf8')))
    })
  })

  it('caps draining from descendants that keep writing', async () => {
    const startedAt = Date.now()
    const result = await runBashProcess({
      command: '(while true; do echo tick; sleep 0.02; done) & echo $!',
      cwd: process.cwd()
    })

    assert.equal(result.status, 'exited')
    assert.ok(Date.now() - startedAt < 4000)
    await waitForProcessExit(Number(result.output.preview.split('\n')[0]))
  })
})
