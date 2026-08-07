import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Support | PhotoTree",
  robots: { index: false, follow: false },
};

export default function SupportPage() {
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || process.env.SUPPORT_EMAIL || "";

  return (
    <main className="legal-page">
      <h1>PhotoTree Support</h1>
      <p>
        PhotoTree is available to invited family members. If you need the invite code, help signing in, help importing
        photos, or a data deletion request, contact the family administrator.
      </p>
      {supportEmail ? (
        <p>
          Email: <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
        </p>
      ) : (
        <p>Before App Store submission, add a support email in the production environment.</p>
      )}
    </main>
  );
}
