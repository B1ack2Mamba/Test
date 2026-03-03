import type { AppProps } from "next/app";
import Head from "next/head";
import { useEffect } from "react";
import "@/styles/globals.css";
import dynamic from "next/dynamic";

// Native runtime overlay (Capacitor): client-side only
const NativeRuntimeNoSSR = dynamic(
  () => import("@/components/NativeRuntime").then((m) => m.NativeRuntime),
  { ssr: false }
);

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    let cleanup: (() => void) | null = null;

    (async () => {
      // Если это Capacitor (нативная оболочка) — лучше не регистрировать SW,
      // чтобы не залипать на кэше и получать обновления с домена сразу.
      try {
        const core = await import("@capacitor/core");
        if (core.Capacitor.isNativePlatform()) return;
      } catch {
        // capacitor not installed / web
      }

      const onLoad = () => {
        navigator.serviceWorker.register("/sw.js").catch(() => {
          // silent
        });
      };

      window.addEventListener("load", onLoad);
      cleanup = () => window.removeEventListener("load", onLoad);
    })();

    return () => {
      try {
        cleanup?.();
      } catch {
        // ignore
      }
    };
  }, []);

  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#eef2ff" />
        <link rel="icon" href="/krost-mark.png" />

        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
      </Head>

      <NativeRuntimeNoSSR />
      <Component {...pageProps} />
    </>
  );
}
