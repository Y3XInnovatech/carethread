const API = "/api/v1";

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

export function wsUrl(topic: string, params?: Record<string, string>): string {
  const u = new URL(`/ws`, window.location.origin);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.searchParams.set("topic", topic);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      u.searchParams.set(k, v);
    }
  }
  return u.toString();
}
