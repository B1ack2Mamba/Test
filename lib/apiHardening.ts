import type { NextApiResponse } from "next";

const TRANSIENT_PATTERNS = [
  /ETIMEDOUT/i,
  /terminated/i,
  /network/i,
  /fetch failed/i,
  /socket hang up/i,
  /ECONNRESET/i,
  /503/i,
  /502/i,
  /504/i,
  /temporar/i,
];

export function isTransientErrorMessage(message: string) {
  return TRANSIENT_PATTERNS.some((re) => re.test(String(message || "")));
}

export async function retryTransientApi<T>(fn: () => PromiseLike<T> | T, opts?: { attempts?: number; delayMs?: number }) {
  const attempts = Math.max(1, Number(opts?.attempts || 2));
  const delayMs = Math.max(0, Number(opts?.delayMs || 120));
  let lastErr: any = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message || err || "");
      if (i >= attempts - 1 || !isTransientErrorMessage(msg)) throw err;
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}

export function setNoStore(res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}
