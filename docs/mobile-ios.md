# PhotoTree iOS and TestFlight Plan

PhotoTree is currently a server-backed Next.js app. It uses NextAuth, Prisma, Google Photos APIs, and Vercel Blob, so the first iPhone version should be a native iOS shell that loads the deployed HTTPS app. That keeps the database, auth, and Google Photos flows on the server where they already work.

## Automated In This Repo

- Added Capacitor dependencies.
- Added `capacitor.config.ts`.
- `capacitor.config.ts` reads `.env.local` / `.env` automatically, while still allowing `MOBILE_APP_URL` and `MOBILE_APP_ID` to override values for release builds.
- Added npm scripts:
  - `npm run mobile:sync`
  - `npm run mobile:open`
  - `npm run mobile:doctor`
- Added a web app manifest so the deployed site can also be installed from Safari with Add to Home Screen.
- Generated the native iOS project in `ios/`.
- Replaced the generated iOS app icon with the existing PhotoTree logo.

## Recommended Release Path

1. Deploy the web app to a stable HTTPS URL.
   - Vercel is the natural fit for this repo.
   - The URL must remain stable for the iOS wrapper.

2. Update environment variables for the deployed web app.
   - `NEXTAUTH_URL=https://your-deployed-domain.example`
   - `NEXTAUTH_SECRET=...`
   - `GOOGLE_CLIENT_ID=...`
   - `GOOGLE_CLIENT_SECRET=...`
   - `DATABASE_URL=...`
   - `DIRECT_URL=...`

3. Update Google OAuth settings in Google Cloud Console.
   - Authorized JavaScript origins:
     - `https://your-deployed-domain.example`
   - Authorized redirect URIs:
     - `https://your-deployed-domain.example/api/auth/callback/google`
   - Keep your local development callback if you still use local auth:
     - `http://localhost:3000/api/auth/callback/google`

4. Pick an iOS bundle identifier.
   - Current default: `com.phototree.familytreephotos`
   - Change by running sync with:
     - `MOBILE_APP_ID=com.yourname.phototree MOBILE_APP_URL=https://your-deployed-domain.example npm run mobile:sync`

5. Sync the iOS project.
   - `MOBILE_APP_URL=https://your-deployed-domain.example npm run mobile:sync`
   - If you do not pass `MOBILE_APP_URL`, the sync will use `NEXTAUTH_URL` from `.env.local`. Localhost is fine for local simulator testing, but TestFlight must use HTTPS.

6. Open Xcode.
   - `npm run mobile:open`
   - If Xcode command-line tools are not fully installed/selected, install Xcode from the Mac App Store, open it once, then run:
     - `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`

7. In Xcode, configure signing.
   - Select the `App` target.
   - Set Team to your Apple Developer team.
   - Confirm Bundle Identifier.
   - Confirm Version and Build number.
   - Let Xcode manage signing unless you have a specific provisioning setup.

8. Run on an iPhone directly.
   - Connect the iPhone by cable or use wireless debugging.
   - Select the physical device in Xcode.
   - Press Run.
   - Trust the developer profile on the iPhone if prompted.

9. Upload to TestFlight.
   - In Xcode: Product > Archive.
   - In Organizer: Distribute App.
   - Choose App Store Connect.
   - Upload the archive.

10. Configure TestFlight in App Store Connect.
    - Create the app record if it does not exist.
    - Add internal testers first.
    - Internal testing supports up to 100 App Store Connect users.
    - External testing supports up to 10,000 testers but the first external build needs Apple beta review.

## Alternative: No App Store, No TestFlight

From iPhone Safari:

1. Open the deployed PhotoTree URL.
2. Tap Share.
3. Tap Add to Home Screen.
4. Launch PhotoTree from the home screen icon.

This is the fastest way to use it like an app, but it is not distributed through TestFlight or the App Store.

## Notes Before App Store Release

Apple may reject apps that are only a thin wrapper around a website for public App Store release. TestFlight is still useful for private testing, but a public App Store submission should add iOS-specific value over time, such as native photo picking/upload, share sheet support, push notifications, offline viewing, or iCloud/keychain integration.
