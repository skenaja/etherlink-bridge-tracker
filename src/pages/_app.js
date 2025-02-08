import { IBM_Plex_Mono } from 'next/font/google'
import "@/styles/globals.css";

export const roboto_mono = IBM_Plex_Mono({
  subsets: ['latin'],
  display: 'swap',
  weight: ['200', '400', '700'],
  variable: '--font-roboto-mono',
})

export default function App({ Component, pageProps }) {
  return (
    <main className={`${roboto_mono.variable} font-mono`}>
      <Component {...pageProps} />
    </main>
  );
}
