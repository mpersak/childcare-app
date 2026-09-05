/**
 * Minimal GitHub Contents API client.
 *
 * Only ever handed ciphertext. The repository must be private, but the point of
 * encrypting first is that a mistake there is not a disclosure of anyone's data.
 */

export interface GithubConfig {
  owner: string
  repo: string
  branch: string
  /** Folder inside the repo, e.g. "data". */
  path: string
  token: string
}

export interface RemoteFile {
  content: string
  sha: string
}

/** Thrown when the remote moved on since we last read it. */
export class ConflictError extends Error {
  constructor(message = 'The copy on GitHub changed since this device last synced.') {
    super(message)
    this.name = 'ConflictError'
  }
}

export class GithubError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'GithubError'
  }
}

const API = 'https://api.github.com'

function headers(cfg: GithubConfig): HeadersInit {
  return {
    Authorization: `Bearer ${cfg.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  }
}

function filePath(cfg: GithubConfig, name: string): string {
  const folder = cfg.path.replace(/^\/+|\/+$/g, '')
  return folder ? `${folder}/${name}` : name
}

async function fail(res: Response): Promise<never> {
  let detail = res.statusText
  try {
    const body = await res.json() as { message?: string }
    if (body.message) detail = body.message
  } catch { /* keep the status text */ }
  if (res.status === 401) throw new GithubError('GitHub rejected the token. Check it has not expired.', 401)
  if (res.status === 403) throw new GithubError(`GitHub refused the request: ${detail}`, 403)
  if (res.status === 404) throw new GithubError('Repository or path not found. Check the owner, repo and token scope.', 404)
  throw new GithubError(detail, res.status)
}

/** Returns null when the file does not exist yet — the first-run case. */
export async function getFile(cfg: GithubConfig, name: string): Promise<RemoteFile | null> {
  const url = `${API}/repos/${cfg.owner}/${cfg.repo}/contents/${filePath(cfg, name)}?ref=${encodeURIComponent(cfg.branch)}`
  const res = await fetch(url, { headers: headers(cfg) })
  if (res.status === 404) return null
  if (!res.ok) return fail(res)

  const body = await res.json() as { content?: string; sha: string; encoding?: string }
  if (body.content && body.encoding === 'base64') {
    // The API wraps base64 at 60 chars.
    return { content: atob(body.content.replace(/\n/g, '')), sha: body.sha }
  }

  // Large files come back without inline content; fetch the blob instead.
  const blobRes = await fetch(
    `${API}/repos/${cfg.owner}/${cfg.repo}/git/blobs/${body.sha}`,
    { headers: headers(cfg) },
  )
  if (!blobRes.ok) return fail(blobRes)
  const blob = await blobRes.json() as { content: string }
  return { content: atob(blob.content.replace(/\n/g, '')), sha: body.sha }
}

/**
 * Writes a file. Passing the sha we last saw makes this a compare-and-swap:
 * GitHub rejects the write if someone else changed it first.
 */
export async function putFile(
  cfg: GithubConfig,
  name: string,
  content: string,
  sha: string | null,
  message: string,
): Promise<string> {
  const url = `${API}/repos/${cfg.owner}/${cfg.repo}/contents/${filePath(cfg, name)}`
  const res = await fetch(url, {
    method: 'PUT',
    headers: headers(cfg),
    body: JSON.stringify({
      message,
      content: btoa(content),
      branch: cfg.branch,
      ...(sha ? { sha } : {}),
    }),
  })

  // 409 is the documented conflict; 422 covers "sha wasn't supplied but the file exists".
  if (res.status === 409 || res.status === 422) throw new ConflictError()
  if (!res.ok) return fail(res)

  const body = await res.json() as { content: { sha: string } }
  return body.content.sha
}

export async function deleteFile(
  cfg: GithubConfig, name: string, sha: string, message: string,
): Promise<void> {
  const url = `${API}/repos/${cfg.owner}/${cfg.repo}/contents/${filePath(cfg, name)}`
  const res = await fetch(url, {
    method: 'DELETE',
    headers: headers(cfg),
    body: JSON.stringify({ message, sha, branch: cfg.branch }),
  })
  if (!res.ok && res.status !== 404) await fail(res)
}

/** Confirms the token works and the repo is reachable and private. */
export async function checkAccess(cfg: GithubConfig): Promise<{ private: boolean; defaultBranch: string }> {
  const res = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}`, { headers: headers(cfg) })
  if (!res.ok) return fail(res)
  const body = await res.json() as { private: boolean; default_branch: string; permissions?: { push?: boolean } }
  if (!body.permissions?.push) {
    throw new GithubError('That token can read the repository but not write to it.', 403)
  }
  return { private: body.private, defaultBranch: body.default_branch }
}
