// Browser-side fetch helper. Throws an Error whose message comes from the { error: { message } } body.
export async function apiFetch<T>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: 'same-origin',
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const message = (body as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(message ?? `Request failed (${res.status})`);
  }
  return body as T;
}
