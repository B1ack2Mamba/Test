import { useEffect, useMemo, useRef, useState } from "react";

type Mode = "ok" | "offline" | "down";

async function fetchWithTimeout(url: string, ms = 4000): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    return !!r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export function NativeRuntime() {
  const [isNative, setIsNative] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>("ok");

  const failStreak = useRef(0);
  const mounted = useRef(false);

  const appHost = useMemo(() => {
    if (typeof window === "undefined") return null;
    return window.location.host;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    (async () => {
      if (typeof window === "undefined") return;

      const core = await import("@capacitor/core");
      const native = core.Capacitor.isNativePlatform();
      setIsNative(native);
      if (!native) return;

      // Mark DOM for native-specific CSS tweaks (status bar safe spacing, etc.)
      try {
        document.documentElement.classList.add("native-app");
      } catch {
        // ignore
      }

      // --- External links: open outside the app ---
      try {
        const { Browser } = await import("@capacitor/browser");
        const onClick = async (e: any) => {
          const a = e?.target?.closest?.("a");
          if (!a) return;
          const href = a.getAttribute("href");
          if (!href) return;

          // ignore in-page anchors and relative links
          if (href.startsWith("#") || href.startsWith("/")) return;
          if (!href.startsWith("http")) return;

          try {
            const u = new URL(href);
            // If link goes to another host -> open in external browser
            if (appHost && u.host !== appHost) {
              e.preventDefault();
              await Browser.open({ url: href });
            }
          } catch {
            // ignore
          }
        };

        document.addEventListener("click", onClick, true);
      } catch {
        // ignore
      }

      // --- Android back button behavior ---
      try {
        const { App } = await import("@capacitor/app");
        const sub = App.addListener("backButton", ({ canGoBack }) => {
          try {
            if (canGoBack) window.history.back();
            else App.exitApp();
          } catch {
            // ignore
          }
        });
        // unsubscribe on unmount
        // @ts-ignore
        (window as any).__cap_back_sub = sub;
      } catch {
        // ignore
      }

      // --- Network status ---
      try {
        const { Network } = await import("@capacitor/network");
        const st = await Network.getStatus();
        if (!mounted.current) return;
        setConnected(!!st.connected);

        const sub = await Network.addListener("networkStatusChange", (s) => {
          if (!mounted.current) return;
          setConnected(!!s.connected);
        });
        // @ts-ignore
        (window as any).__cap_net_sub = sub;
      } catch {
        // ignore
      }
    })();

    return () => {
      try {
        // @ts-ignore
        (window as any).__cap_back_sub?.remove?.();
        // @ts-ignore
        (window as any).__cap_net_sub?.remove?.();

        try {
          document.documentElement.classList.remove("native-app");
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appHost]);

  // --- Health check loop (only when native) ---
  useEffect(() => {
    if (!isNative) return;

    let timer: any = null;
    const tick = async () => {
      if (!mounted.current) return;

      // if no network -> offline
      if (connected === false) {
        setServerOk(null);
        setMode("offline");
        failStreak.current = 0;
        return;
      }

      // unknown network -> do nothing yet
      if (connected == null) return;

      const ok = await fetchWithTimeout("/api/health", 4000);
      if (!mounted.current) return;

      setServerOk(ok);

      if (ok) {
        failStreak.current = 0;
        setMode("ok");
        return;
      }

      failStreak.current += 1;
      // show DOWN only after 2 consecutive failures to avoid flicker
      if (failStreak.current >= 2) {
        setMode("down");
      }
    };

    // run immediately and then every 10s
    tick();
    timer = setInterval(tick, 10_000);

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isNative, connected]);

  if (!isNative) return null;

  if (mode === "ok") return null;

  const title = mode === "offline" ? "Нет интернета" : "Сервис недоступен";
  const desc =
    mode === "offline"
      ? "Проверь Wi‑Fi/мобильные данные и попробуй ещё раз."
      : "Интернет есть, но сервер не отвечает. Попробуй обновить страницу чуть позже.";

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-indigo-50/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-2xl border border-indigo-200/60 bg-white/85 p-4 shadow-xl">
        <div className="text-base font-semibold tracking-tight text-slate-900">{title}</div>
        <div className="mt-2 text-sm text-slate-600">{desc}</div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              try {
                window.location.reload();
              } catch {
                // ignore
              }
            }}
          >
            Повторить
          </button>

          <div className="ml-auto text-xs text-slate-500 self-center">
            {connected === false ? "offline" : serverOk === false ? "down" : "…"}
          </div>
        </div>
      </div>
    </div>
  );
}
