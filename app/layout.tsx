import "./globals.css";
import { Providers } from "./providers";
import Header from "./ui/header";
import { cookies } from "next/headers";

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
