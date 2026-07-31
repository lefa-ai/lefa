import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'

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

  if (!processExists(pid)) return
  process.kill(pid, 'SIGKILL')
  assert.fail(`Process ${pid} is still running`)
}

it(
  'terminates the process group when output storage cannot be created',
  {
    skip: process.platform !== 'darwin' && process.platform !== 'linux',
    timeout: 5000
  },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lefa-bash-storage-'))
    const invalidHome = join(directory, 'home')
    const pidPath = join(directory, 'pid')
    const originalHome = process.env.HOME
    let pid: number | undefined
    await writeFile(invalidHome, 'not a directory')
    process.env.HOME = invalidHome

    try {
      const modulePath = './bash-process.ts'
      const { runBashProcess } = (await import(modulePath)) as typeof import('./bash-process.ts')
      const writer = `process.stdout.write('x'.repeat(60 * 1024)); setInterval(() => {}, 1000)`

      await assert.rejects(
        runBashProcess({
          command: `echo $$ > ${shellQuote(pidPath)}; trap '' TERM; ${shellQuote(process.execPath)} -e ${shellQuote(writer)}`,
          cwd: directory
        }),
        { code: 'ENOTDIR' }
      )

      const content = (await readFile(pidPath, 'utf8')).trim()
      pid = Number(content)
      assert.ok(Number.isSafeInteger(pid) && pid > 0)
      await waitForProcessExit(pid)
    } finally {
      if (pid !== undefined && processExists(pid)) process.kill(pid, 'SIGKILL')
      if (originalHome === undefined) delete process.env.HOME
      else process.env.HOME = originalHome
      await rm(directory, { recursive: true, force: true })
    }
  }
)
