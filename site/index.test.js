import { access, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const html = await readFile(new URL('./index.html', import.meta.url), 'utf8')
const siteDirectory = fileURLToPath(new URL('.', import.meta.url))
const openPages = new Set()

function createMediaQuery(matches) {
  const listeners = new Set()

  return {
    matches,
    addEventListener: vi.fn((_event, listener) => listeners.add(listener)),
    removeEventListener: vi.fn((_event, listener) => listeners.delete(listener)),
    setMatches(value) {
      this.matches = value
      for (const listener of listeners) listener({ matches: value })
    }
  }
}

function loadPage({ reducedMotion = true, finePointer = false, fetch = vi.fn() } = {}) {
  const motion = createMediaQuery(reducedMotion)
  const pointer = createMediaQuery(finePointer)
  const dom = new JSDOM(html, {
    url: 'https://lefa.ai',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = fetch
      window.matchMedia = vi.fn((query) =>
        query.includes('prefers-reduced-motion') ? motion : pointer
      )
      window.requestAnimationFrame = vi.fn(() => 1)
      window.cancelAnimationFrame = vi.fn()
    }
  })

  openPages.add(dom)
  return { dom, document: dom.window.document, fetch, motion, pointer }
}

function submit(dom, form) {
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
}

afterEach(() => {
  for (const page of openPages) page.window.close()
  openPages.clear()
})

describe('landing page', () => {
  it('references existing local metadata and icon assets', async () => {
    const { document } = loadPage()
    const localReferences = [...document.querySelectorAll('link[href]')]
      .map((element) => element.getAttribute('href'))
      .filter((href) => href?.startsWith('/') && href !== '/')

    for (const href of localReferences) await access(join(siteDirectory, href.slice(1)))

    const manifest = JSON.parse(await readFile(join(siteDirectory, 'site.webmanifest'), 'utf8'))
    expect(manifest.name).toBe('Lefa')
    expect(manifest.theme_color).toBe('#a3e635')
    for (const icon of manifest.icons) {
      await access(join(siteDirectory, icon.src.slice(1)))
    }
  })

  it('finishes the workspace illustration immediately for reduced motion', () => {
    const { document } = loadPage()
    const card = document.querySelector('.ws-card')

    expect(card?.classList.contains('is-ready')).toBe(true)
    expect(document.querySelectorAll('.ws-stage.on')).toHaveLength(5)
    expect(document.querySelectorAll('.ws-event.on')).toHaveLength(4)
    expect(document.querySelector('.ws-diff-stat')?.textContent).toBe('+214 −38 · 12 files')
  })

  it('stops animation and finishes when reduced motion is enabled', () => {
    const { document, motion } = loadPage({ reducedMotion: false })

    expect(document.querySelector('.ws-card')?.classList.contains('is-ready')).toBe(false)
    motion.setMatches(true)
    expect(document.querySelector('.ws-card')?.classList.contains('is-ready')).toBe(true)
  })

  it('runs and stops the fine-pointer cursor with the motion preference', () => {
    const { dom, document, motion } = loadPage({
      reducedMotion: false,
      finePointer: true
    })
    const dot = document.querySelector('.cur-dot')
    const pentagon = document.querySelector('.cur-pent')
    const link = document.querySelector('.gh-btn')

    dom.window.dispatchEvent(
      new dom.window.MouseEvent('mousemove', { clientX: 20, clientY: 30 })
    )
    expect(document.documentElement.classList.contains('cc')).toBe(true)
    expect(dot?.style.opacity).toBe('1')
    expect(dot?.style.transform).toBe('translate(20px,30px)')

    link?.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true }))
    expect(pentagon?.classList.contains('hot')).toBe(true)
    dom.window.dispatchEvent(new dom.window.MouseEvent('mousedown'))
    expect(pentagon?.classList.contains('down')).toBe(true)
    dom.window.dispatchEvent(new dom.window.MouseEvent('mouseup'))
    expect(pentagon?.classList.contains('down')).toBe(false)

    motion.setMatches(true)
    expect(document.documentElement.classList.contains('cc')).toBe(false)
    expect(dot?.style.opacity).toBe('0')
    expect(pentagon?.classList.contains('hot')).toBe(false)
  })

  it('rejects an invalid email without calling the API', () => {
    const { dom, document, fetch } = loadPage()
    const form = document.querySelector('#wl-form')
    const input = document.querySelector('#wl-email')
    input.value = 'invalid'

    submit(dom, form)

    expect(fetch).not.toHaveBeenCalled()
    expect(document.querySelector('#waitlist')?.classList.contains('shake')).toBe(true)
    expect(document.activeElement).toBe(input)
  })

  it('shows the submitted address after a successful signup', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true })
    const { dom, document } = loadPage({ fetch })
    const form = document.querySelector('#wl-form')
    const input = document.querySelector('#wl-email')
    const button = document.querySelector('.wl-btn')
    input.value = 'person@example.com'

    submit(dom, form)

    await vi.waitFor(() => {
      expect(document.querySelector('#waitlist')?.classList.contains('ok')).toBe(true)
    })
    expect(fetch).toHaveBeenCalledWith('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'person@example.com' })
    })
    expect(document.querySelector('#wl-echo')?.textContent).toBe(
      "person@example.com. We'll ping you at launch."
    )
    expect(button.disabled).toBe(false)
  })

  it('offers the email fallback when the API fails', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 })
    const { dom, document } = loadPage({ fetch })
    const form = document.querySelector('#wl-form')
    const input = document.querySelector('#wl-email')
    input.value = 'person@example.com'

    submit(dom, form)

    await vi.waitFor(() => {
      expect(document.querySelector('#waitlist')?.classList.contains('alt')).toBe(true)
    })
    expect(document.querySelector('#wl-mailto')?.href).toContain(
      'Please%20add%20person%40example.com%20to%20the%20Lefa%20waitlist.'
    )
  })

  it('prevents duplicate submissions while one request is pending', async () => {
    let resolveRequest
    const fetch = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve
        })
    )
    const { dom, document } = loadPage({ fetch })
    const form = document.querySelector('#wl-form')
    const input = document.querySelector('#wl-email')
    input.value = 'person@example.com'

    submit(dom, form)
    submit(dom, form)

    expect(fetch).toHaveBeenCalledOnce()
    resolveRequest({ ok: true })
    await vi.waitFor(() => {
      expect(document.querySelector('#waitlist')?.classList.contains('ok')).toBe(true)
    })
  })
})
