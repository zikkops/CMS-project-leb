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
  - **The cloud checks the phone first (S20).** The app makes a new key with
    the cloud's one-time challenge written into its attestation, and sends the
    Keystore's certificate chain. The cloud registers it only if Google's chain
    says the key is in secure hardware, on a phone with a locked bootloader and
    a verified system, unlocked only by a strong fingerprint or face for each
    use, made by this app, and not on Google's list of compromised keys. A
    phone that fails uses "Ask a manager".
  - **Sign in with your fingerprint:** works with or without the internet. The
    hub's challenge is signed after the fingerprint, and the till opens signed
    in until 05:00.
  - **Requests:** the app's own requests are native (`HubHttp.java`). To the
    hub, only the pinned certificate is trusted.
- **No fingerprint on this phone? Ask a manager** (S6, S15–S17). The staff
  member chooses their first name and asks. A manager taps "Approve a
  sign-in" in their own app and approves with their fingerprint. This phone
  then opens the till as the person approved, until 05:00.
  The manager can also **Turn down** a request, with the same fingerprint, and
  the asking phone is told.
- **Sign in the counter PC** (S24–S25). On the counter PC's sign-in screen, tap
  your name; it shows a four-digit code. In the app, tap "Sign in the counter
  PC", type the code, and confirm with your fingerprint. The counter signs in as
  you, with no internet, and signs out after 15 minutes without a tap.
- **Use this device as a kitchen screen** (S19). A shared kitchen tablet asks,
  and a manager approves it with their fingerprint. It opens the kitchen
  display, signed in as the screen rather than a person, until 05:00. The hub
  refuses it everything but the kitchen display: no tables, checks, payments or
  drawer. Registered phones are listed and removed in admin
  under Settings → Staff Phones.

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
- **The emulator's own attestation (S20).** Its key's chain was read by the
  cloud's code: the challenge and the app matched, and the lock was fingerprint
  only for each use. It was refused twice over, as it should be: its key is in
  software, and its root is Google's test root, not a real one. **So an
  emulator cannot register**; test registering on a real phone.
- **Not yet run:**
  - a real phone on the café wifi
  - scanning a QR with a real camera
  - registering through the app, which needs a real phone and a real password
