/**
 * Google Drive upload for the backup archive.
 *
 * Uses Google Identity Services with the `drive.file` scope, which grants access
 * only to files this app itself creates — it cannot see anything else in the
 * drive. There is no client secret and no backend; the access token lives in
 * memory for about an hour and is never persisted.
 *
 * The honest limit: a static site cannot hold a refresh token, so "automatic"
 * means "runs when the app is open and Google will re-issue a token silently".
 * A backup cannot happen while the app is closed.
 */

const SCOPE = 'https://www.googleapis.com/auth/drive.file'
const GIS_SRC = 'https://accounts.google.com/gsi/client'

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void
  callback: (res: { access_token?: string; error?: string }) => void
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(cfg: {
            client_id: string
            scope: string
            callback: (res: { access_token?: string; error?: string }) => void
          }): TokenClient
        }
      }
    }
  }
}

let gisPromise: Promise<void> | null = null

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (gisPromise) return gisPromise
  gisPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Could not load Google sign-in. Check the connection.'))
    document.head.appendChild(script)
  })
  return gisPromise
}

let cachedToken: { value: string; expires: number } | null = null

/**
 * `silent` asks Google not to show a consent screen. It succeeds only once the
 * user has consented before and still has a live Google session, which is what
 * makes an unattended-ish scheduled backup possible.
 */
export async function getAccessToken(clientId: string, silent = false): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value
  await loadGis()

  const oauth2 = window.google?.accounts?.oauth2
  if (!oauth2) throw new Error('Google sign-in is unavailable.')

  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: res => {
        if (res.error || !res.access_token) {
          reject(new Error(res.error === 'popup_closed_by_user'
            ? 'Google sign-in was closed.'
            : res.error || 'Google did not return a token.'))
          return
        }
        cachedToken = { value: res.access_token, expires: Date.now() + 55 * 60_000 }
        resolve(res.access_token)
      },
    })
    client.requestAccessToken(silent ? { prompt: '' } : undefined)
  })
}

export function forgetToken(): void {
  cachedToken = null
}

/** Finds, or creates, the folder the backups go into. */
async function ensureFolder(token: string, name: string): Promise<string> {
  const q = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and name='${name.replace(/'/g, "\\'")}' and trashed=false`,
  )
  const found = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=1`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (found.ok) {
    const body = await found.json() as { files: { id: string }[] }
    if (body.files?.[0]) return body.files[0].id
  }

  const created = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }),
  })
  if (!created.ok) throw new Error('Could not create the backup folder in Drive.')
  return ((await created.json()) as { id: string }).id
}

export async function uploadBackup(
  clientId: string, folderName: string, filename: string, blob: Blob, silent = false,
): Promise<string> {
  const token = await getAccessToken(clientId, silent)
  const folderId = await ensureFolder(token, folderName || 'Childcare backups')

  const metadata = { name: filename, parents: [folderId] }
  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  form.append('file', blob)

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form },
  )
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json() as { error?: { message?: string } }
      if (body.error?.message) detail = body.error.message
    } catch { /* keep the status text */ }
    throw new Error(`Drive rejected the upload: ${detail}`)
  }
  const body = await res.json() as { webViewLink?: string }
  return body.webViewLink ?? 'Uploaded to Drive.'
}
