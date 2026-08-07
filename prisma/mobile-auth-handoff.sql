CREATE TABLE IF NOT EXISTS "MobileAuthHandoff" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "sessionToken" TEXT NOT NULL,
  "targetPath" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  CONSTRAINT "MobileAuthHandoff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MobileAuthHandoff_tokenHash_key"
  ON "MobileAuthHandoff"("tokenHash");

CREATE INDEX IF NOT EXISTS "MobileAuthHandoff_expiresAt_idx"
  ON "MobileAuthHandoff"("expiresAt");
