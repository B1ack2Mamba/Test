import type { AppProps } from "next/app";
import Head from "next/head";
import "@/styles/globals.css";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#eef2ff" />
        <link rel="icon" href="/krost-mark.png" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
