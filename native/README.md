# Phone apps (Capacitor)

The games as Android apps (iPhone later): the same web build inside a native app, made with [Capacitor](https://capacitorjs.com/).
One folder per game: `native/<game>/` (only `wall` so far). The whole plan, costs and store steps:
[WALLBREAK on Android](https://claude.ai/artifact/TdaLhThEY7Q3vesak4RkDu).

## How it fits the platforms

`VITE_PLATFORM=android` picks [core/platforms/CapacitorPlatform.ts](../core/platforms/CapacitorPlatform.ts), like `poki` picks
PokiPlatform. It does:

- **Saves**: the app's own storage (`@capacitor/preferences`).
- **Ads**: AdMob (`@capacitor-community/admob`), only for the kinds with an ad unit set in the game's `platforms.config.json`;
  the others, and everything in a browser, use the mock ads (the AD PLACEHOLDER screen, always rewarded). So with no AdMob
  account it all works, with mock ads. Interstitials are paced in the class (none in the first 90 s, then one every 2 min at most).
- **Back button**: `PlatformHandler.backButton` (Wall: closes the rewind popup or the wardrobe); nothing open, the app goes to the
  background.
- **Pause**: the app going to the background mutes and pauses the game (`onPause` / `onResume`).
- Portrait only, full screen (no status or navigation bar).

The AdMob settings, in `games/wall/platforms.config.json`:

```json
"android": {
    ...
    "admob": { "appId": "", "interstitial": "", "rewarded": "", "test": true }
}
```

- Empty: mock ads (Google's sample app id goes into the app so it starts).
- `appId` (`ca-app-pub-...~...`) and an ad unit (`ca-app-pub-.../...`): real AdMob ads of that kind.
- `test: true`: AdMob's test ads, even with your own ids. Keep it on until the store release: tapping your own live ads gets
  the AdMob account closed.

## Once: install

1. [Android Studio](https://developer.android.com/studio) (free). It brings Java, the Android SDK and the emulator. On first
   start, let it install the SDK (Android 16 / API 36).
2. On the phone: Settings > About phone > tap **Build number** 7 times (developer options), then Settings > System > Developer
   options > **USB debugging** on. Plug it in and allow the computer.

## Every time: build and play on the phone

From PowerShell at the repo root, with `GAME=wall` in `.env`:

```
npm run android
```

It opens the **Android panel** (http://localhost:9310, [tools/android/panel](../tools/android/panel)):

- **This computer**: Node, Android Studio, its Java, the SDK, the Android platform the app builds against, the build tools, adb,
  the Capacitor packages and the game's Android project, each with what to do when it's missing.
- **Package**: the app's name, id and version (name and code), saved into the Capacitor config, `build.gradle` and `strings.xml`.
- **Ads, purchases, analytics**: the AdMob ids (empty: mocked), test ads, ads on or off; what's set up for purchases and analytics.
- **Devices**: the phones plugged in (and the emulators made in Android Studio), refreshed every few seconds; pick one.
- **Buttons**: Run on device, Build APK, Install APK on device, Open in Android Studio, Build only. The build log comes in live
  (Stop cuts it short), and Show in folder finds the APK.

The same steps on the command line:

| Command | What it does |
| --- | --- |
| `npm run android:sync` | builds the game for the app and copies it into `native/wall/android` |
| `npm run android:open` | ... and opens it in Android Studio: pick the phone at the top, press Run |
| `npm run android:run` | ... and installs and starts it on the plugged-in phone (`-- --target <serial>` for one of several) |
| `npm run android:apk` | ... and builds `native/wall/android/app/build/outputs/apk/debug/app-debug.apk`: copy it to any phone and open it (allow installing unknown apps) |

Each build also makes the app's icon and splash from `games/<game>/icon/icon.png` ([tools/android/icons.mjs](../tools/android/icons.mjs)).

The first Android Studio / gradle build downloads a lot and takes several minutes; later ones are quick.

To see the game's console on the phone: Chrome on the computer, `chrome://inspect`, the app's WebView > inspect.

## Real ads (when there's an AdMob account)

1. [AdMob](https://admob.google.com/) > Apps > Add app > Android (not listed yet is fine) > copy the **app id**.
2. Ad units > add an **Interstitial** and a **Rewarded** > copy their ids.
3. Put them in `platforms.config.json` (`android.admob`), keep `test: true`, `npm run android:run`. The ads say "Test Ad".
4. In Europe/UK AdMob needs a consent message: AdMob > Privacy & messaging > GDPR > create one. The app shows it on start.
5. For the store: `test: false`, and an `app-ads.txt` on the developer website (the plan has the details).

## Google Play: the AAB

In the panel (`npm run android`), **Keys** lists every key the app needs, set or missing, with where to get it and a link:
the AdMob ids, the **upload key**, the RevenueCat key (empty: purchases mocked), the Play Console account.

1. **Upload key**, once: *Create a key* (Java's keytool makes `<game>-upload.jks`, alias `upload`) or *Use one I have*. It's
   written to `native/<game>/android/keystore.properties`, which git ignores; the key file goes outside the repo. **Back the
   .jks and its password up.**
2. **Build AAB (Google Play)**, or `npm run android:aab`: the signed bundle at
   `native/<game>/android/app/build/outputs/bundle/release/app-release.aab` (Show in folder).
3. Before each upload: version code +1 (Package), AdMob test ads off for a real release.

## Before the store (not needed to play)

- **The app id** `com.hyperchip.wallbreak` (`native/wall/capacitor.config.json`): change it now if it should be another; it can
  never change after the first upload to Google Play.
- **Icon and splash**: still Capacitor's defaults. `npx @capacitor/assets generate` in `native/wall` makes every size from
  `assets/icon.png` (1024×1024) and `assets/splash.png`.
- **Signing**: Android Studio > Build > Generate Signed App Bundle. Keep the keystore and its passwords out of the repo (it's
  public; `*.jks`, `*.keystore` and `keystore.properties` are ignored) and backed up: lose it and the app can't be updated.
- **Analytics**: `measure()` only logs in the app for now (Firebase or GameAnalytics next).
- **Purchases**: RevenueCat (`@revenuecat/purchases-capacitor`), keys in `platforms.config.json` `android.iap`:
  - `revenuecatTest` (`test_…`, RevenueCat's **Test Store**): used by every debug build (`android:run`, `android:apk`, Android
    Studio). Buying shows RevenueCat's own sheet with succeed / fail / cancel; no Play account, no real money. Add the
    products to the Test Store in RevenueCat with the game's shop ids (`starter`, `no_ads`, … in `games/wall/ui/wall.json`).
  - `revenuecat` (`goog_…`): used by the AAB (`android:aab`), real Google Play Billing. The products made in Play Console
    with the same ids, imported into RevenueCat. Never a `test_` key here: the SDK crashes a release build with one (the
    build script refuses it).
  - No key for the build: mocked purchases (the BUY / CANCEL screen). The settings' console shows what RevenueCat did.

## A new game's app

```
mkdir native/<game>                # capacitor.config.json + package.json as in native/wall (webDir: ../../dist/_builds_<game>/android)
cd native/<game>; npx cap add android
```

Then the manifest's AdMob `meta-data` and `screenOrientation` as in `native/wall/android/app/src/main/AndroidManifest.xml`, an
`android` entry in the game's `platforms.config.json`, and `PlatformHandler.ADMOB = config?.admob` in its `index.ts`.
