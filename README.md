# GPS Track PWA

## What is included

- iPhone-friendly PWA layout
- Start / Stop GPS recording
- High-accuracy GPS using `watchPosition`
- Total distance calculation
- Current speed and GPS accuracy
- IndexedDB storage
- Autosaves the active track after every accepted GPS point
- Recovers an unfinished track after a reload
- Saved track list with View/Delete
- Service worker for offline application shell
- GitHub Pages compatible

## Important iPhone limitation

Safari/iOS does not guarantee continuous GPS collection when the PWA is suspended or the phone is locked. For reliable recording, keep the PWA in the foreground.

## Offline map limitation

The application and GPS data work offline after the PWA has been opened/installed while online. The OpenStreetMap base-map tiles are not bundled with this app, so a completely offline session may show the track without the normal street/terrain tiles unless those tiles are already available from the browser cache.

Do not bulk-download/cache OpenStreetMap tiles; follow the OpenStreetMap tile usage policy.

## GitHub Pages

Create a GitHub repository, upload all files in this folder to the repository root, then enable:

Settings -> Pages -> Deploy from a branch -> main -> /(root)

Open the resulting HTTPS URL in Safari on the iPhone and use Share -> Add to Home Screen.
