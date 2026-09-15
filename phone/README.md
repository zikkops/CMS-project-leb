# BIG CMS Staff — the Android app

POS software, stage 5. The plan and the owner's decisions are in the vault:
`01 - Projects/BIG CMS Project/POS Software (Local Hub) - Scope.md` (S2, S4–S6,
S11).

Staff phones reach the café hub over the café wifi **through this app,
encrypted, and never over plain http** (S11). The hub has its own certificate,
which no browser trusts. This app trusts exactly that certificate, by the
SHA-256 fingerprint in the QR on the counter PC's `/pos/hub` page.

It wraps the same React screens as everything else: once paired, the hub's own
`/pos` pages load in the app's WebView from the hub's address. It is not a
second till.

## What it does, and does not

- **Pairing:** scan the counter screen's QR, or paste the link under it
  (`bigcms-hub:https://<private address>:3443#sha256=<hex>`). The app's page
  reads it with `parseHubLink()` from `shared/src/hubNetwork.ts`, bundled in,
  not copied. The native `HubPin` plugin checks it again before storing it.
- **Trust:** `HubWebViewClient` accepts a certificate Android refused only at
  the paired hub's exact origin, and only if its SHA-256 is the pinned one
  (`HubPin.trusts()`). Every other certificate error is refused, as before.
- **Only the app's own page can pair.** Capacitor exposes plugins to the app's
  origin, not to the hub's pages, so a page served by a hub (or by something
  pretending to be one) cannot re-pin the phone.
- **Fingerprint or face sign-in (S12–S14).**
  - **The key:** a P-256 key in the Android Keystore that only strong
    biometrics unlock (`HubKeys.java`), never the phone's PIN.
  - **Register this phone:** needs the internet, once. Email and password go
    to Firebase, then the fingerprint signs the registration, and the cloud
    stores the public key.
  - **Sign in with your fingerprint:** works with or without the internet. The
    hub's challenge is signed after the fingerprint, and the till opens signed
    in until 05:00.
  - **Requests:** the app's own requests are native (`HubHttp.java`). To the
    hub, only the pinned certificate is trusted.
- **Not yet:** the manager fallback for a phone with no strong biometrics (S6),
  a list of phones in admin, and the kitchen display mode.

## Build it

Outside the npm workspaces on purpose, like `desktop/`: Capacitor and Gradle
must never reach a Hostinger build.

Needs Android Studio (for the SDK), and **a Java 21 JDK**:
- The QR scanner plugin asks Gradle for a Java 21 toolchain.
- Capacitor's Gradle 8.14.3 cannot run on Android Studio's bundled Java 25.

```bash
npm install
npm run sync
```

`npm run sync` bundles `src/app.ts` into `www/app.js` and copies it into
`android/`. Then build and test with the JDK 21:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot'
cd android
.\gradlew.bat testDebugUnitTest assembleDebug
```

`android/local.properties` names the SDK. Write it with **forward slashes**:
`sdk.dir=C:/Users/<you>/AppData/Local/Android/Sdk`. In a properties file a
backslash is an escape, so the Windows spelling is silently a different path.

The app's minimum is Android 8 (API 26), because the scanner's library needs
it.

## Checked

- `HubPinTest` asserts the trust rules on the JVM.
- The debug app ran on an Android 37 emulator against a built hub on this PC,
  paired with a fake cloud. The emulator reaches this PC as `10.0.2.2`.
  - **A link with the wrong fingerprint:** the app stayed on its own page, and
    the hub's handshake was refused (`net_error -202`).
  - **The right one:** it opened `https://10.0.2.2:3443/pos/login` as a secure
    context, marked as a hub, with its scripts running.
  - **A page from the hub has no Capacitor bridge**, so it could not reach
    `HubPin`.
- **Not yet run:**
  - a real phone on the café wifi
  - scanning a QR with a real camera
  - signing in through the app
