export class ApiError extends Error {
  status: number
  /** Stable code from the server (e.g. KYC_REQUIRED) to branch on; `message` is safe to show. */
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** JSON call to the Express API. Vite proxies /api, so the session cookie is same-origin. */
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data: { error?: string; message?: string } = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    // proxy error pages are not JSON; fall through to the generic message
  }
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'ERROR', data.message ?? 'Could not reach the server.')
  return data as T
}
