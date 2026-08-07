# PhotoTree Unlisted App Store Release

This is the fastest durable distribution path for family members on personal iPhones:

- Use a normal App Store build.
- Request **Unlisted App** distribution so the app is available only by direct link.
- Keep `PHOTOTREE_FAMILY_CODE` enabled so the direct link alone is not enough to enter the family archive.

Apple's unlisted app docs say unlisted apps are available to anyone with the link, so the invite code is the actual family access control.

Useful Apple references:

- https://developer.apple.com/support/unlisted-app-distribution/
- https://developer.apple.com/app-store/review/guidelines/
- https://developer.apple.com/support/volume-purchase-and-custom-apps/

## Automated In This Repo

- Added a family invite-code gate:
  - `PHOTOTREE_FAMILY_CODE` turns it on.
  - A signed, HTTP-only cookie keeps approved devices unlocked.
  - The existing guest flow still works after the invite code.
- Added public App Store URLs:
  - `/privacy`
  - `/support`
- Allowed `/privacy` and `/support` through the iOS-only middleware.
- Added App Store release scripts:
  - `npm run appstore:precheck`
  - `npm run appstore:prepare`
  - `npm run appstore:archive`
- Bumped the iOS build number to `5`.

## Manual Steps

### 1. Pick The Access Model

Recommended: **Unlisted App Store app + family invite code**.

Estimated time: 5 minutes.

Why not Custom App: Custom Apps are stricter, but they are aimed at Apple Business Manager or Apple School Manager organizations. For family members on personal devices, they add more setup than they save.

Why not TestFlight: TestFlight builds expire.

Why not public searchable App Store: not needed for a family-only archive.

### 2. Set Production Environment Variables

In Vercel, open the PhotoTree project, then go to **Settings > Environment Variables**.

Add these to **Production**:

- `PHOTOTREE_FAMILY_CODE`: a private invite code you will send to family members.
- `SUPPORT_EMAIL` or `NEXT_PUBLIC_SUPPORT_EMAIL`: the email Apple and family members can use for support/privacy requests.
- `IOS_ONLY_ACCESS_ENABLED=true`: keeps the hosted web app from being browsable outside the iOS shell, while leaving `/privacy` and `/support` public.

Confirm these existing variables are also present:

- `DATABASE_URL`
- `DIRECT_URL`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `BLOB_READ_WRITE_TOKEN`

For production, `NEXTAUTH_URL` should be:

```bash
https://photo-tree-cyan.vercel.app
```

Estimated time: 10-20 minutes.

### 3. Redeploy Production

Redeploy the Vercel production app after adding environment variables.

Estimated time: 5-10 minutes.

Then check:

- `https://photo-tree-cyan.vercel.app/privacy`
- `https://photo-tree-cyan.vercel.app/support`
- the iOS app root view

The iOS app should ask for the family invite code when `PHOTOTREE_FAMILY_CODE` is enabled. If `IOS_ONLY_ACCESS_ENABLED=true`, a normal desktop browser should see the iOS-only message at the root URL.

### 4. Run Automated App Store Prep

From the repo root:

```bash
MOBILE_APP_URL=https://photo-tree-cyan.vercel.app npm run appstore:prepare
```

This runs the Next.js build, syncs Capacitor, checks App Store readiness, verifies the Xcode project, and performs an unsigned Release build.

Estimated time: 10-30 minutes.

### 5. Create The Archive

From the repo root:

```bash
MOBILE_APP_URL=https://photo-tree-cyan.vercel.app npm run appstore:archive
```

This creates a signed archive in Xcode's Archives folder. If signing fails, open Xcode and confirm the `App` target uses your Apple Developer team.

Estimated time: 10-20 minutes.

### 6. Upload To App Store Connect

Open Xcode:

1. Window > Organizer.
2. Select the latest `PhotoTree App Store ...` archive.
3. Click **Validate App**.
4. Fix any validation issues.
5. Click **Distribute App**.
6. Choose **App Store Connect**.
7. Choose **Upload**.

Estimated active time: 10-20 minutes.

### 7. Fill App Store Connect Metadata

In App Store Connect, create or open the PhotoTree app record.

Suggested fields:

- Name: `PhotoTree`
- Subtitle: `Private family photo archive`
- Category: `Photo & Video`
- Price: `Free`
- Privacy Policy URL: `https://photo-tree-cyan.vercel.app/privacy`
- Support URL: `https://photo-tree-cyan.vercel.app/support`

Suggested description:

```text
PhotoTree is a private family tree and photo archive for invited family members. It helps relatives browse family relationships, view saved family photos, tag people in photos, and add selected photos to the shared family archive.
```

Suggested keywords:

```text
family tree, family photos, photo archive, genealogy
```

Suggested review notes:

```text
PhotoTree is intended for unlisted App Store distribution to invited family members. It is not a beta build.

Family invite code for review: [ENTER CODE]

The reviewer can inspect the core app by entering the family invite code and choosing "Continue without Google Photos." Google Photos connection is optional and is used only when a family member wants to import selected photos from their own Google Photos library. The backend is live at https://photo-tree-cyan.vercel.app.
```

Estimated time: 45-90 minutes, mostly screenshots and privacy questions.

### 8. App Privacy Guidance

Use App Store Connect's exact current wording, but this app should generally answer along these lines:

- Data used to track you: `No`
- Third-party advertising: `No`
- Analytics: `No`, unless you add analytics later.
- Data linked to user:
  - Contact Info: email address if users connect Google Photos.
  - User Content: photos, photo metadata, family tree entries, relationships, tags, descriptions.
  - Identifiers: user/account identifier if App Store Connect asks about authentication identifiers.
- Purposes:
  - App Functionality.
  - Account Management, if asked for Google sign-in/session data.
- Photos permission purpose: importing selected family photos.

Estimated time: 20-40 minutes.

### 9. Request Unlisted App Distribution

After the app record exists in App Store Connect, submit Apple's unlisted app request:

https://developer.apple.com/contact/request/unlisted-app/

In the request, explain:

```text
PhotoTree is a private family tree and family photo archive for a limited audience of invited family members. It is not intended for general App Store search or discovery. The app includes an invite-code gate to prevent unauthorized access if the direct App Store link is forwarded.
```

Estimated active time: 10 minutes.

Apple processing time: commonly 1-2 business days, but plan for a few days.

### 10. Submit For App Review

Attach the uploaded build to version `1.0`, complete all required metadata, then submit for review.

Estimated active time: 15-30 minutes after metadata is complete.

Apple review time: usually 1-3 days, longer if they ask questions or reject something.

### 11. Release And Invite Family

After approval and unlisted distribution are active:

1. Release the app.
2. Copy the App Store link.
3. Send the link and `PHOTOTREE_FAMILY_CODE` to family members.
4. Tell them they can use the app without TestFlight expiration.

Estimated time: 10 minutes.

## Remaining Risks

- Apple can still reject a limited-audience app if it appears incomplete, beta-like, or only a thin website wrapper. PhotoTree has native iOS photo import, which helps.
- If Apple tests Google Photos import, they may need a review-access path. The review notes tell them to use the non-Google path for core review; if they insist on Google import, provide a Google test account with sample photos.
- If the Google OAuth consent screen is still in Testing mode, family access may be limited by Google's test-user rules. For long-term family use with Google Photos import, make sure the Google OAuth app is configured for the intended users.
