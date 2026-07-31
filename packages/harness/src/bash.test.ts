import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { asSchema } from 'ai'
import { runBashProcess } from './bash-process.ts'
import { createBashTool, type BashOutput } from './bash.ts'
import { MAX_BYTES } from './truncate.ts'

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
    await delay(20)
  }

  if (!processExists(pid)) return

  killProcess(pid)
  assert.fail(`Process ${pid} is still running`)
}

async function waitForPidFile(path: string): Promise<number> {
  const deadline = Date.now() + 2000

  while (Date.now() < deadline) {
    try {
      const content = (await readFile(path, 'utf8')).trim()
      const pid = Number(content)

      if (Number.isSafeInteger(pid) && pid > 0) return pid
      if (content) throw new Error(`Invalid PID in ${path}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    await delay(10)
  }

  throw new Error(`Timed out waiting for a PID in ${path}`)
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function killProcess(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

const supportsBash = process.platform === 'darwin' || process.platform === 'linux'

describe('bash tool', { skip: !supportsBash }, () => {
  it('defines the model input and text output', async () => {
    const bash = createBashTool('.')
    const schema = asSchema(bash.inputSchema)

    assert.deepEqual(await schema.validate?.({ command: 'pwd' }), {
      success: true,
      value: { command: 'pwd' }
    })
    assert.equal((await schema.validate?.({ command: 'pwd', timeout: 1 }))?.success, false)
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

  it('spills complete large output while returning a bounded tail', async () => {
    const source = 'x'.repeat(60 * 1024)
    const result = await executeBash(process.cwd(), {
      command: `${shellQuote(process.execPath)} -e "process.stdout.write('x'.repeat(60 * 1024))"`
    })
    const match = result.content.match(/^\[Output truncated\. Full output: (.+)\]\n\n([\s\S]+)$/)
    const outputPath = match?.[1]

    try {
      assert.ok(match)
      assert.ok(outputPath)
      const preview = match[2]
      assert.ok(preview)
      assert.equal(Buffer.byteLength(preview), MAX_BYTES)
      assert.equal(preview, source.slice(-MAX_BYTES))
      assert.equal(await readFile(outputPath, 'utf8'), source)
    } finally {
      if (outputPath) await rm(outputPath, { force: true })
    }
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
      let pid: number | undefined

      try {
        pid = await waitForPidFile(pidPath)
        controller.abort()
        await assert.rejects(execution, { name: 'AbortError' })
        await waitForProcessExit(pid)
      } finally {
        controller.abort()
        await execution.catch(() => undefined)
        if (pid !== undefined && processExists(pid)) killProcess(pid)
      }
    })
  })

  it('cancels stubborn descendants and preserves the abort reason', async () => {
    await withTempDirectory(async (directory) => {
      const pidPath = join(directory, 'pid')
      const controller = new AbortController()
      const reason = new Error('cancelled by caller')
      const execution = executeBash(
        directory,
        {
          command: `(trap '' TERM; exec >/dev/null 2>&1; while true; do sleep 1; done) & echo $! > ${shellQuote(pidPath)}; sleep 30`
        },
        controller.signal
      )
      let pid: number | undefined

      try {
        pid = await waitForPidFile(pidPath)
        controller.abort(reason)
        await assert.rejects(execution, (error) => error === reason)
        await waitForProcessExit(pid)
      } finally {
        controller.abort(reason)
        await execution.catch(() => undefined)
        if (pid !== undefined && processExists(pid)) killProcess(pid)
      }
    })
  })

  it('cancels descendants while draining output after the shell exits', async () => {
    await withTempDirectory(async (directory) => {
      const shellPidPath = join(directory, 'shell-pid')
      const childPidPath = join(directory, 'child-pid')
      const controller = new AbortController()
      const reason = new Error('cancelled while draining')
      let settled = false
      const execution = executeBash(
        directory,
        {
          command: `echo $$ > ${shellQuote(shellPidPath)}; (while true; do echo tick; sleep 0.02; done) & echo $! > ${shellQuote(childPidPath)}`
        },
        controller.signal
      )
      void execution.then(
        () => {
          settled = true
        },
        () => {
          settled = true
        }
      )
      let shellPid: number | undefined
      let childPid: number | undefined

      try {
        shellPid = await waitForPidFile(shellPidPath)
        childPid = await waitForPidFile(childPidPath)
        await waitForProcessExit(shellPid)
        assert.equal(settled, false)

        controller.abort(reason)
        await assert.rejects(execution, (error) => error === reason)
        await waitForProcessExit(childPid)
      } finally {
        controller.abort(reason)
        await execution.catch(() => undefined)
        if (shellPid !== undefined && processExists(shellPid)) killProcess(shellPid)
        if (childPid !== undefined && processExists(childPid)) killProcess(childPid)
      }
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

  it('reports signal termination without throwing', async () => {
    assert.deepEqual(
      await executeBash(process.cwd(), {
        command: "printf 'before\\n'; kill -TERM $$"
      }),
      {
        content: 'before\n\nCommand terminated by SIGTERM.'
      }
    )
  })

  it('throws when Bash cannot be spawned in the working directory', async () => {
    await withTempDirectory(async (directory) => {
      await assert.rejects(
        runBashProcess({
          command: ':',
          cwd: join(directory, 'missing')
        }),
        { code: 'ENOENT' }
      )
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
    const pid = Number(result.output.preview.trim())

    try {
      assert.equal(result.status, 'exited')
      await waitForProcessExit(pid)
    } finally {
      if (processExists(pid)) killProcess(pid)
    }
  })

  it(
    'kills background descendants that ignore SIGTERM after Bash exits',
    { timeout: 6000 },
    async () => {
      await withTempDirectory(async (directory) => {
        const pidPath = join(directory, 'pid')
        const result = await runBashProcess({
          command: `(trap '' TERM; exec >/dev/null 2>&1; while true; do sleep 1; done) & echo $! > ${shellQuote(pidPath)}`,
          cwd: directory
        })
        const pid = await waitForPidFile(pidPath)

        try {
          assert.equal(result.status, 'exited')
          await waitForProcessExit(pid)
        } finally {
          if (processExists(pid)) killProcess(pid)
        }
      })
    }
  )

  it('caps draining from descendants that keep writing', { timeout: 6000 }, async () => {
    await withTempDirectory(async (directory) => {
      const pidPath = join(directory, 'pid')
      const result = await runBashProcess({
        command: `(while true; do echo tick; sleep 0.02; done) & echo $! > ${shellQuote(pidPath)}`,
        cwd: directory
      })
      const pid = await waitForPidFile(pidPath)

      try {
        assert.equal(result.status, 'exited')
        await waitForProcessExit(pid)
      } finally {
        if (processExists(pid)) killProcess(pid)
      }
    })
  })
})
