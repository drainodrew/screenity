# Screenity recordings in Google Drive, classified with JEV

The existing Screenity extension records and uploads. A Rust native messaging worker transcribes recordings locally with Whisper, classifies their content through the existing TypeSafe JEV API, moves them into the chosen Drive library, and maintains a SQLite transcript search index. A native Rust macOS app provides search, recording links, and a private API key entry form.

This integration is opt-in. Stock builds retain upstream Screenity behavior. A local configuration without its own Google OAuth client leaves the library integration disabled and emits a build warning. Do not interpret a successful stock build as a connected library.

## Recording flow

1. Save a recording to Google Drive from Screenity. The configured Inbox is verified against the configured root before upload.
2. After the upload succeeds, the extension persists the video ID and title in a retry queue. Google access tokens are never stored in that queue.
3. The native worker downloads the video, transcribes it locally, and sends the title and transcript evidence to `https://api.typesafe.ai/v1/systemone`, using `jev-latest`. Videos are not sent to JEV. Transcripts over 30,000 characters use beginning, middle, and ending excerpts; search retains the complete transcript.
4. Both department and purpose must meet the 0.80 confidence threshold. Otherwise, the recording goes to Needs Review. The taxonomy and definitions are in [taxonomy.json](config/taxonomy.json).
5. The worker stores the transcript beside the recording, moves the recording without changing its Drive ID, and records a receipt and searchable catalog entry. Moving a recording preserves existing document links to it.

Departments: Sales, Marketing, Acquisitions, Operations, Construction, Data & Automation, Finance, People & Training, and Personal. Purposes: How-tos, SOPs, Training, Meetings, Walkthroughs, and Reference.

## Set up a personal installation

Requirements: macOS 13+, Rust stable with file locking support (tested with 1.98.1), Node/npm, ffmpeg, and the OpenAI Whisper CLI. The current transcription settings are English, `tiny.en`, CPU, and two threads. This Mac must be available for automatic processing. Recordings remain saved in Drive when the native worker is unavailable; retries occur every two minutes when Chrome is running.

1. Create a Drive folder and its Inbox. Keep their observed IDs in `integration.config.local.json`, copied from [local.example.json](config/local.example.json). Account configuration, private keys, tokens, transcripts, and recordings must remain outside Git.
2. Generate a private extension key outside the repository. Set `extensionPublicKey` to its base64-encoded DER public key. The configure script prints the stable extension ID derived from that key.
3. Use a separate Google Cloud project, enable the Google Drive API, configure Google Auth Platform for the intended account/audience, and create a **Chrome Extension** OAuth client associated with that stable extension ID. Put the client ID in `oauthClientId`. Do not reuse upstream Screenity's client or alter another application's OAuth client.
4. Select an appropriate Drive scope. `drive.file` works only for folders/files explicitly granted to this OAuth application, such as through a Picker flow. Folders created by a different connector are not automatically granted. The current integration has no Picker; reusing those pre-existing folders requires the user to consent to the `drive` scope, or a separate future folder-grant flow. Google consent and any Workspace restrictions still apply.
5. Build and configure:

   ```sh
   npm ci
   node integration/scripts/check-queue.mjs
   cargo test --manifest-path integration/worker/Cargo.toml
   cargo build --release --manifest-path integration/worker/Cargo.toml
   cargo build --release --manifest-path integration/native/Cargo.toml
   node integration/scripts/configure.mjs
   node integration/scripts/install-native.mjs
   npm run build:release
   ```

6. In Chrome's extension management page, load `build/` as an unpacked extension. Confirm its ID matches the native host's allowed origin. Complete Google Drive consent in Screenity, save one short recording, and verify its transcript, destination folder, native search result, and final worker receipt before treating automatic sorting as live.
7. Open `~/Applications/Screenity Library.app`, choose JEV settings, and save the TypeSafe API key. The masked form writes a private `~/.config/screenity-library/jev.env` file with mode 0600. Set `typesafeEnvFile` in the local integration configuration to that path before installing the native host. The worker can also use `TYPESAFE_API_KEY` from its environment. No API key belongs in extension code.

Chrome requires manual extension installation and Google consent. Installation of the native app alone does not connect or activate the recorder's Drive integration.

## Search, recovery, and migration

The native app searches recording titles, complete transcripts, departments, and purposes. Search results mark uncertain categories for review and open the original stable Drive video URL. Use Drive to review and manage the Needs Review folder; the current app does not provide a classification approval editor.

```sh
screenity-library status
screenity-library search '"batchleads"*'
screenity-library classify --id VERIFIED_DRIVE_ID --title "Recording title" \
  --transcript /absolute/path/transcript.txt --url VERIFIED_DRIVE_URL
```

For a Loom migration, preserve the original files and a source-Loom-ID → verified-Drive-ID mapping outside this repository. Verify uploaded sizes and reader permissions before replacing document links. Native Docs edits should retain labels, formatting, tabs, and revision guards. Export and back up Office files before changing their hyperlink targets in place. Incomplete uploads and unavailable audiences must keep their original Loom links until resolved.

Private worker data lives in `~/.local/share/screenity-library`. Jobs use private short-lived token files removed on completion or reported failure. Completed receipts prevent repeated moves; JEV responses are cached against the request and taxonomy. Folder lookup and transcription are serialized. Failed jobs stay in the extension's queue and can retry with a fresh token; an interrupted worker's per-recording lease expires after one hour. Check `worker.log` for processing failures. Classification uses the existing account's API usage and has no added daily spend cap.

The integration has been compiled and tested independently of the Google connection. A complete acceptance check still requires an installed extension, valid account consent, and an actual new recording through the entire flow.
