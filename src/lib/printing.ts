/**
 * Printing and saving files, written for iOS as much as for a desktop.
 *
 * Two things behave badly on an iPad, which is where these documents actually
 * get used:
 *
 *  - `<a download>` is ignored for `blob:` URLs in Safari, so the usual trick
 *    silently does nothing. The Web Share sheet does work, and is the native way
 *    to save or send a file, so it is tried first.
 *  - `window.print()` can no-op depending on how the page was opened. Printing a
 *    purpose-built window containing only the document is far more reliable —
 *    and gives a cleaner page, since none of the app chrome is there to hide.
 */

function isProbablyIOS(): boolean {
  // iPadOS reports as Mac, so the touch-point check is what catches an iPad.
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/**
 * Offers a file to the user by whatever route the device actually supports.
 * Returns how it was delivered, so the caller can say something useful.
 */
export async function shareOrDownload(
  filename: string, content: string, mime: string,
): Promise<'shared' | 'downloaded' | 'opened'> {
  const file = new File([content], filename, { type: mime })

  // The share sheet is the reliable route on a phone or tablet.
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename })
      return 'shared'
    } catch (err) {
      // A cancelled share is not a failure; do not fall through and surprise them.
      if (err instanceof Error && err.name === 'AbortError') return 'shared'
    }
  }

  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename

  // Safari ignores `download` for blob URLs, so open it instead of doing nothing.
  if (isProbablyIOS()) {
    a.target = '_blank'
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return 'opened'
  }

  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return 'downloaded'
}

/** Every same-origin stylesheet rule, so the print window looks like the app. */
function collectCss(): string {
  const out: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) out.push(rule.cssText)
    } catch {
      // A cross-origin sheet (the webfont) cannot be read; the fallback font stack covers it.
    }
  }
  return out.join('\n')
}

/**
 * Prints one element on its own page.
 *
 * Falls back to printing the whole app if a popup is blocked, so the button
 * always does something.
 */
export function printNode(selector: string, title: string): 'window' | 'inline' | 'missing' {
  const node = document.querySelector(selector)
  if (!node) return 'missing'

  const win = window.open('', '_blank')
  if (!win) {
    window.print()
    return 'inline'
  }

  win.document.write(
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<title>${title.replace(/[<>]/g, '')}</title>` +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<style>${collectCss()}</style>` +
    '<style>body{margin:0;padding:8mm;background:#fff;color:#000}' +
    // The document is the whole page here, so let it size to the paper.
    '.no-print{display:none!important}' +
    '.table-scroll,.sheet,.bn-sheet{overflow:visible!important}' +
    '.table,.sheet-table,.bn-table{min-width:0!important}</style>' +
    '</head><body>' + node.outerHTML + '</body></html>',
  )
  win.document.close()

  // Give the browser a moment to lay the page out (and load the font) before printing.
  const go = () => { win.focus(); win.print() }
  if (win.document.readyState === 'complete') setTimeout(go, 300)
  else win.addEventListener('load', () => setTimeout(go, 300))

  return 'window'
}
