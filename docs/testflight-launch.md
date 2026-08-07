# PhotoTree TestFlight Launch Checklist

Use this path to share PhotoTree with a small family group without a public App Store listing.

## Automated Prep

Run these from the project root:

```bash
MOBILE_APP_URL=https://photo-tree-cyan.vercel.app npm run testflight:prepare
npm run testflight:archive
```

`MOBILE_APP_URL` must be the deployed HTTPS Vercel URL that family iPhones can reach.
The current PhotoTree production URL is `https://photo-tree-cyan.vercel.app`.
If that URL is already synced into the iOS project, `npm run testflight:prepare` will reuse it.
`npm run testflight:archive` creates a signed `.xcarchive` in Xcode's Archives folder so it can be uploaded through Xcode Organizer.

## Vercel Required Environment Variables

Confirm these exist in Vercel for Production and Preview:

- `DATABASE_URL`
- `DIRECT_URL`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `BLOB_READ_WRITE_TOKEN`

For TestFlight, `NEXTAUTH_URL` should be the deployed HTTPS site URL, not localhost.

## Manual Apple Steps

1. Enroll in the Apple Developer Program.
2. Open `ios/App/App.xcodeproj` in Xcode.
3. Select the `App` target.
4. Set Signing Team to your Apple Developer team.
5. Keep the bundle identifier stable: `com.phototree.familytreephotos`.
6. Set a version and build number.
7. Select `Any iOS Device` or a generic iOS destination.
8. Open Window > Organizer.
9. Select the latest PhotoTree archive.
10. Choose Distribute App > App Store Connect > Upload.
11. In App Store Connect, create the PhotoTree app record if it does not exist.
12. Add the uploaded build to TestFlight.
13. Add family testers by email or invite link.

## Tester Instructions

Each family member should:

1. Install TestFlight from the App Store.
2. Open your TestFlight invite.
3. Install PhotoTree.
4. Sign in with Google.

## Notes

- TestFlight builds expire after 90 days.
- A production TestFlight build must not point at `localhost`.
- Images are saved durably through Vercel Blob. If uploads fail, re-check `BLOB_READ_WRITE_TOKEN`.
