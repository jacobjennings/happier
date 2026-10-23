# Build Jake's fork

Build from a workspace based on `main@origin` in `jacobjennings/happier`.
These are local development builds, not upstream releases. Run commands from the
repository root using Bash and Docker on Linux x86-64. No Expo account is needed.
Do not run tests here. The scheduled runner on main owns tests.

## Shared setup

The UI's existing Expo config owns identity overrides. Keep generated files,
credentials and logs under ignored `.project/`, never in a commit. Set
`RELAY_URL` to the HTTPS URL phones use to reach the relay, or leave it empty.
An empty value uses same-origin discovery on web. On Android, select the relay
in Settings before signing in (the built-in default remains upstream).

```bash
export RELAY_URL='' # Or https://your-relay.example.com
export SOURCE_SHA=$(jj log -r @- --no-graph -T 'commit_id')
export FORK_VERSION="0.2.19-jake.${SOURCE_SHA:0:12}"
mkdir -p .project/fork-builds
cat > .project/fork-builds/local-config.cjs <<'CONFIG'
module.exports = {
  updates: { enabled: false },
  android: { googleServicesFile: '', versionCode: Number(process.env.FORK_ANDROID_VERSION_CODE || 2026102301) },
};
CONFIG

docker run --rm --user "$(id -u):$(id -g)" \
  -e HOME=/repo/.project/home \
  -e HAPPIER_INSTALL_SCOPE=ui,protocol,agents,cli-common,release-runtime,transfers,connection-supervisor,audio-stream-native,sherpa-native \
  -e HAPPIER_UI_VENDOR_WEB_ASSETS=0 \
  -v "$PWD:/repo" -w /repo node:22.14.0-bookworm bash -c '
    set -e
    mkdir -p "$HOME"
    npm install --prefix .project/build-tools yarn@1.22.22
    export PATH="/repo/.project/build-tools/node_modules/.bin:$PATH"
    bash scripts/ci/yarn-install-with-retry.sh --frozen-lockfile --ignore-engines --network-timeout 600000 --non-interactive
  '
```

The local config disables upstream Expo OTA updates and removes upstream Firebase
configuration, whose Android package does not match our fork. Upstream push
notification credentials are not supplied. Keep the signing key and password
backed up privately before removing this workspace.

## Web

```bash
docker run --rm --user "$(id -u):$(id -g)" \
  -e HOME=/repo/.project/home -e CI=1 -e APP_ENV=production \
  -e EXPO_APP_NAME='Happier (Jake)' -e EXPO_APP_VERSION="$FORK_VERSION" \
  -e EXPO_PUBLIC_HAPPY_SERVER_URL="$RELAY_URL" \
  -e EXPO_APP_LOCAL_CONFIG_PATH=/repo/.project/fork-builds/local-config.cjs \
  -e HAPPIER_UI_VENDOR_WEB_ASSETS=0 \
  -v "$PWD:/repo" -w /repo node:22.14.0-bookworm bash -c '
    set -e
    export PATH="/repo/.project/build-tools/node_modules/.bin:$PATH"
    node scripts/pipeline/release/build-ui-web-bundle.mjs --version "$EXPO_APP_VERSION"
  '
```

The export is `apps/ui/dist/`. The existing release script also validates the PWA,
precompresses assets and produces an archive and checksums in
`dist/release-assets/ui-web/`. Settings reads the Expo version, including `-jake`
and the source commit. An explicit relay URL is embedded at build time.

### Serve it from the relay (orchestrator and owner only)

The pinned `happierdev/relay-server` image includes upstream UI files. Its
`HAPPIER_SERVER_UI_DIR` override allows our export to replace them without
rebuilding the server. Copy the complete export to a readable directory on the
relay host, then add this Compose override beside
`~/gh/jake-harness2/relay/compose.yaml`:

```yaml
services:
  relay:
    environment:
      HAPPIER_SERVER_UI_DIR: /opt/happier/fork-web
      HAPPIER_SERVER_UI_REQUIRED: "1"
    volumes:
      - /srv/happier/fork-web:/opt/happier/fork-web:ro
```

After owner approval, from that Compose directory:

```bash
docker compose --env-file ../versions.env --env-file .env \
  -f compose.yaml -f compose.fork.yaml up -d
```

Keep the original image pin, relay secrets and `relay-data` volume. Roll back by
removing the override from the Compose invocation and recreating the relay.
Verify the served Settings version and a real login/session after deployment.
This UI/server combination still needs live compatibility verification.

If a server source change is also needed, the root Dockerfile already has a
source-backed target:

```bash
docker build --target relay-server-local-source \
  --build-arg SENTRY_RELEASE="$SOURCE_SHA" \
  --build-arg EXPO_PUBLIC_HAPPY_SERVER_URL="$RELAY_URL" \
  -t "happier-relay:jake-${SOURCE_SHA:0:12}" .
```

That target embeds `/opt/happier/ui-web` and builds both server and UI from this
checkout. The ordinary `relay-server` target downloads signed upstream artifacts,
so it does not build our source. The optional source image command above does
not apply the local Expo version override. Use the mounted export for the fork
UI identity. Neither image building nor this task authorizes live deployment.

## Android APK

Use package `com.jacobjennings.happier` and scheme `happier-jake` alongside the
store app. A new signing key cannot update the installed store app in place.
Using its package ID requires uninstalling it first, with possible local-data
loss. Future fork upgrades require this same key and a larger `versionCode`.

Create a reusable Android build environment. This follows upstream Dagger's SDK
image and Node version without requiring its Expo account or EAS credentials.

```bash
mkdir -p .project/fork-builds/toolchain
cat > .project/fork-builds/toolchain/Dockerfile <<'DOCKER'
FROM node:22.14.0-bookworm AS node
FROM ghcr.io/cirruslabs/android-sdk:34
COPY --from=node /usr/local/ /usr/local/
RUN sdkmanager "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006" "cmake;3.22.1"
RUN chmod -R a+rwX /opt/android-sdk-linux
DOCKER
docker build -t happier-fork-android:local .project/fork-builds/toolchain

# Generate once only. Reuse and privately back up both files.
(
  set -e
  umask 077
  mkdir -p .project/fork-builds/signing
  test ! -e .project/fork-builds/signing/jake.jks
  test ! -e .project/fork-builds/signing/password
  openssl rand -hex 32 > .project/fork-builds/signing/password
  keytool -genkeypair -keystore .project/fork-builds/signing/jake.jks \
    -storetype PKCS12 -alias jake -keyalg RSA -keysize 3072 -validity 10000 \
    -dname 'CN=Jacob Jennings' \
    -storepass:file .project/fork-builds/signing/password \
    -keypass:file .project/fork-builds/signing/password
)

cat > .project/fork-builds/unsigned.gradle <<'GRADLE'
gradle.beforeProject { p ->
    p.plugins.withId('com.android.application') {
        p.androidComponents.finalizeDsl { android ->
            android.buildTypes.release.signingConfig = null
        }
    }
}
GRADLE
export FORK_ANDROID_VERSION_CODE=2026102301

docker run --rm --user "$(id -u):$(id -g)" \
  -e HOME=/repo/.project/home -e GRADLE_USER_HOME=/repo/.project/gradle \
  -e CI=1 -e APP_ENV=production -e NODE_ENV=production \
  -e EXPO_APP_NAME='Happier (Jake)' -e EXPO_APP_VERSION="$FORK_VERSION" \
  -e EXPO_ANDROID_PACKAGE=com.jacobjennings.happier \
  -e EXPO_APP_SCHEME=happier-jake -e FORK_ANDROID_VERSION_CODE \
  -e EXPO_PUBLIC_HAPPY_SERVER_URL="$RELAY_URL" \
  -e EXPO_APP_LOCAL_CONFIG_PATH=/repo/.project/fork-builds/local-config.cjs \
  -e HAPPIER_UI_VENDOR_WEB_ASSETS=0 -e EXPO_UNSTABLE_WEB_MODAL=1 \
  -e HAPPIER_ANDROID_BUILD_ARCHS=arm64-v8a \
  -e HAPPIER_ANDROID_GRADLE_JVMARGS="-Xmx4096m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8" \
  -e SENTRY_DISABLE_AUTO_UPLOAD=true \
  -v "$PWD:/repo" -w /repo happier-fork-android:local bash -c '
    set -e
    export PATH="/repo/.project/build-tools/node_modules/.bin:$PATH"
    node apps/ui/scripts/ensureWorkspacePackagesBuilt.mjs
    yarn --cwd apps/ui expo prebuild --platform android --no-install
    cd apps/ui/android
    ./gradlew -I /repo/.project/fork-builds/unsigned.gradle :app:assembleRelease -x lintVitalRelease -x lintVitalAnalyzeRelease
    cd /repo
    tools="$ANDROID_HOME/build-tools/36.0.0"
    "$tools/zipalign" -P 16 -f 4 \
      apps/ui/android/app/build/outputs/apk/release/app-release-unsigned.apk \
      .project/fork-builds/aligned.apk
    "$tools/apksigner" sign --ks .project/fork-builds/signing/jake.jks \
      --ks-key-alias jake --ks-pass file:.project/fork-builds/signing/password \
      --out .project/fork-builds/happier-jake.apk .project/fork-builds/aligned.apk
    "$tools/apksigner" verify --verbose --print-certs .project/fork-builds/happier-jake.apk
    "$tools/zipalign" -c -P 16 4 .project/fork-builds/happier-jake.apk
    "$tools/aapt" dump badging .project/fork-builds/happier-jake.apk | head -1
  '
```

This produces an ARM64 release APK with its JavaScript bundled, without Metro or
EAS. Heap settings and lint exclusions match upstream APK profiles in
`apps/ui/eas.json`. The Gradle init file removes Expo's default debug signing from this generated
release build. `apksigner` applies our key after alignment. No tests are invoked.
Install on an ARM64 Android device with:

```bash
adb install -r .project/fork-builds/happier-jake.apk
```

Select the relay in the app's server settings. Native signing, package ID and
version must be checked from the APK, not inferred from a successful command.

## Recorded build

Built in `/home/jakej/ws/happier/hap-97q` from source commit
`413054f17c814f2b2a3ad6159d38eff2230b9c4d`, the workspace's initial
`main@origin` parent. Only this guide changes tracked source. The version is
`0.2.19-jake.413054f17c81`. Update the base version above when main's UI package
version changes. These artifacts use empty `RELAY_URL`.

- Web: `apps/ui/dist/` and
  `dist/release-assets/ui-web/happier-ui-web-v0.2.19-jake.413054f17c81-web-any.tar.gz`.
  The export/release command exited 0. Log: `.project/fork-builds/web.log`.
- APK: `.project/fork-builds/happier-jake.apk`, ARM64, package
  `com.jacobjennings.happier`, version code `2026102301`.
  Gradle reported `BUILD SUCCESSFUL`. Log: `.project/fork-builds/android.log`.
- `apksigner verify` verified signatures v2 and v3 with one signer,
  `CN=Jacob Jennings`. `zipalign -c -P 16 4` succeeded. `aapt dump badging`
  confirmed the package and fork version. Log:
  `.project/fork-builds/apk-verification.log`.
- Key: `.project/fork-builds/signing/jake.jks`. Password file:
  `.project/fork-builds/signing/password`. Both are mode 0600 and ignored by jj.
  **The orchestrator must back these up outside the workspace before cleanup.**

The first Android attempt exposed an init-hook scoping mistake. A later attempt
failed with Gradle's default 2 GiB heap. Both are corrected in the commands above.
No tests, device installation, live relay deployment, or optional full relay image
build ran. Device launch and login/session compatibility remain for the owner and
orchestrator to verify before rollout.
