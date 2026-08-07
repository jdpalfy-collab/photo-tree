const DEFAULT_ALLOWED_EMAILS = [
  "thomasberry2020@gmail.com",
  "anneberryva@gmail.com",
  "spalfy@gmail.com",
  "aepalfy@gmail.com",
  "3nirgross3@gmail.com",
  "tahoegrace@gmail.com",
  "ypalfy@gmail.com",
  "shanigross3@gmail.com",
  "jdpalfy@gmail.com",
  "jdpalfy5@gmail.com",
];

export function emailAllowlistRequired() {
  return allowedEmailSet().size > 0;
}

export function emailIsAllowed(email?: string | null) {
  const allowed = allowedEmailSet();
  if (allowed.size === 0) return true;
  if (!email) return false;
  return allowed.has(normalizeEmail(email));
}

export function allowedEmailsForDocs() {
  return [...allowedEmailSet()].sort();
}

function allowedEmailSet() {
  const configured = process.env.PHOTOTREE_ALLOWED_EMAILS;
  const emails = configured
    ? configured.split(/[\s,;]+/)
    : DEFAULT_ALLOWED_EMAILS;
  return new Set(
    emails
      .map(normalizeEmail)
      .filter(Boolean)
  );
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}
