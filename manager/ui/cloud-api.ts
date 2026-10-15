export async function cloudApi<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const response = await fetch(`/api/${path}`, { method, cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 || result.code === 'ACCESS_DENIED') window.dispatchEvent(new Event('hanu-auth-expired'));
    throw new Error(result.error ?? 'Không hoàn tất được yêu cầu. Thử lại sau.');
  }
  return result as T;
}
