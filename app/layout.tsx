import "./globals.css";
import { Providers } from "./providers";
import Header from "./ui/header";
import { cookies } from "next/headers";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "PhotoTree",
  description: "A private family tree and photo archive.",
  robots: {
    index: false,
    follow: false,
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "PhotoTree",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/ChatGPT%20Image%20Feb%2010,%202026,%2010_13_52%20PM.png",
    apple: "/ChatGPT%20Image%20Feb%2010,%202026,%2010_13_52%20PM.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#111827",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const modeCookie = cookieStore.get("photoTreeMode")?.value;
  const initialMode =
    modeCookie === "editing" || modeCookie === "viewing" ? modeCookie : undefined;
  return (
    <html lang="en">
      <body>
        <Providers initialMode={initialMode}>
          <Header />
          <div className="site-content">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
