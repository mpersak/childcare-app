import type { Settings } from '../types'

/**
 * Hands a pre-filled message to the user's mail client.
 *
 * Attachments are not possible this way — neither `mailto:` nor Gmail's compose
 * URL accepts a file, and doing it properly needs the Gmail API and OAuth. So the
 * flow is: download the document, then open a composed message to attach it to.
 */

export interface Draft {
  to: string
  cc?: string
  subject: string
  body: string
}

export function gmailComposeUrl(d: Draft): string {
  const p = new URLSearchParams({ view: 'cm', fs: '1', to: d.to, su: d.subject, body: d.body })
  if (d.cc) p.set('cc', d.cc)
  return `https://mail.google.com/mail/?${p.toString()}`
}

export function mailtoUrl(d: Draft): string {
  const p = new URLSearchParams({ subject: d.subject, body: d.body })
  if (d.cc) p.set('cc', d.cc)
  return `mailto:${encodeURIComponent(d.to)}?${p.toString()}`
}

/**
 * Opens the draft. Gmail goes to a new tab, which on a phone hands off to the
 * Gmail app when it is installed; "default" uses the OS mail handler.
 */
export function openDraft(d: Draft, settings: Settings): void {
  if (settings.emailClient === 'gmail') {
    window.open(gmailComposeUrl(d), '_blank', 'noopener')
  } else {
    window.location.href = mailtoUrl(d)
  }
}

/** Very long bodies get truncated by mail clients and by URL limits. */
export const BODY_LIMIT = 1800

export function trimBody(body: string): string {
  return body.length <= BODY_LIMIT
    ? body
    : `${body.slice(0, BODY_LIMIT)}\n\n[...] Full detail is in the attached file.`
}
