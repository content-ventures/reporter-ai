# Drive folder intake

A Google Drive folder feeds Reporter IA without a browser: a file dropped in the folder is copied server to server into source storage, transcribed by the worker, and becomes a production that waits for a person to confirm the speakers' authorization. Nothing runs on the reporter's computer, so a weak connection at an event only has to reach Drive.

## Flow

1. **Entrada.** The reporter drops audio or video (MP3, M4A, MP4, WAV, OGG, FLAC, WEBM, up to 2 GB and 3 hours) in `Entrada`, or in a subfolder of it named after a format (`Estande`, `Painel`, `Premiação`, `Abertura`, `Nota`). Any other place means the article.
2. **Processando.** The Apps Script in `integrations/google-drive/Code.gs` runs every minute on Google's servers. It moves each new file to `Processando` and posts it to `POST /api/reporter/drive/sync` with the intake secret and a short-lived Drive token of the folder owner.
3. **Copy.** The app prepares the same multipart upload the browser uses and, after answering, copies the file from Drive part by part (HTTP ranges of 16 MB) into the worker's presigned URLs. The worker transcribes it as any upload.
4. **Production.** When the transcript is ready, the app runs the material analysis (title and participants) and creates the production the new-production form would create: event origin, the folder's format, the form's default pauta and deliveries, suggested speakers, and the material **not authorized**. It shows as "Falta autorização".
5. **Prontos / Erro.** The script moves the file to `Prontos`, with the production link in the file's description, or to `Erro`, with the reason.

Every step is idempotent per Drive file: the ids, upload token and production request are derived from the file id and the secret, so a repeated sync replays instead of duplicating. To try a failed file again, make a copy of it in `Entrada`.

## Setup

**Vercel (Production):**

- `REPORTER_DRIVE_SECRET`: a random value of 32 or more characters, for example `openssl rand -base64 32`.
- `REPORTER_DRIVE_OWNER_EMAIL`: the member (editor or admin) whose productions the intake creates.

**Google:**

1. Open the event folder, then **Extensions → Apps Script**. If that menu is missing, use [script.google.com](https://script.google.com) → New project, signed in as the folder owner.
2. Paste `integrations/google-drive/Code.gs` into `Code.gs`. If the folder changes, also change `ROOT_FOLDER_ID`.
3. In **Project Settings → Script Properties**, add:
   - `REPORTER_URL`: the Reporter IA address people use, for example `https://reporter-ai-three.vercel.app`. The worker accepts uploads only from its configured app origins.
   - `REPORTER_DRIVE_SECRET`: the same value as in Vercel.
4. Run `setup` once and authorize it. It creates the four subfolders and the one-minute trigger. Its log reads "Pronto".

The executions log in Apps Script shows each file's stage. The app logs only error codes (`drive_upload_failed`, `drive_analysis_failed`, `drive_production_refused`, `drive_production_failed`).

## Security

- Without `REPORTER_DRIVE_SECRET`, the route answers 404. The secret is compared in constant time.
- The Drive token lives about an hour and is used only in memory, for that file's download. It is never stored or logged.
- The database function `reporter_service_context` (migration 021) finds the configured member by email. It is read-only and granted only to the app's runtime role.
