import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | PhotoTree",
  robots: { index: false, follow: false },
};

export default function PrivacyPage() {
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || process.env.SUPPORT_EMAIL || "";

  return (
    <main className="legal-page">
      <h1>Privacy Policy</h1>
      <p>Effective July 5, 2026</p>

      <section>
        <h2>What PhotoTree Collects</h2>
        <p>
          PhotoTree is a private family tree and photo archive for invited family members. The app stores family
          tree entries, relationships, layout choices, photo metadata, tags, descriptions, and photos that users add
          or import.
        </p>
      </section>

      <section>
        <h2>Google Photos</h2>
        <p>
          If you choose to connect Google Photos, PhotoTree uses Google authorization to let you select and import
          photos into the family archive. PhotoTree requests access only for the photo import features shown in the
          app. You can use the app without connecting Google Photos.
        </p>
      </section>

      <section>
        <h2>How Data Is Used</h2>
        <p>
          Data is used to show the family tree, display saved photos, tag people in photos, preserve edits, and keep
          the archive available to invited family members. PhotoTree does not sell personal data, show ads, or use
          third-party tracking for advertising.
        </p>
      </section>

      <section>
        <h2>Service Providers</h2>
        <p>
          PhotoTree relies on hosting, database, storage, authentication, and Apple App Store services to operate the
          app. These providers process data only as needed to provide the app infrastructure.
        </p>
      </section>

      <section>
        <h2>Retention, Deletion, and Revoking Access</h2>
        <p>
          Family archive data is kept until the family administrator removes it or receives a deletion request. You
          can request deletion of your data or ask to remove imported photos using the support contact below. You can
          also revoke PhotoTree Google access from your Google Account permissions.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          {supportEmail
            ? "For privacy or support requests, contact "
            : "For privacy or support requests, contact the PhotoTree family administrator."}
          {supportEmail ? <a href={`mailto:${supportEmail}`}>{supportEmail}</a> : null}
        </p>
      </section>
    </main>
  );
}
