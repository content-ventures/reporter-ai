# Drive folder intake

A Google Drive folder feeds Reporter IA without a browser upload: a file dropped in the folder is copied server to server into source storage and transcribed by the worker. It then waits on the board until a person opens it in Nova produção, exactly as a file they had just uploaded there. Nothing runs on the reporter's computer, so a weak connection at an event only has to reach Drive.

## Flow

1. **Entrada.** The reporter drops audio or video in `Entrada`: MP3, M4A, MP4, WAV, OGG, FLAC or WEBM, up to 2 GB and 3 hours. A subfolder of `Entrada` named after a format (`Estande`, `Painel`, `Premiação`, `Abertura`, `Nota`) picks that format; any other place means the article.
2. **Processando.** The Apps Script in `integrations/google-drive/Code.gs` runs every minute on Google's servers. It moves each new file to `Processando` and posts it to `POST /api/reporter/drive/sync` with the intake secret and a short-lived Drive token of the folder owner.
3. **Copy.** The app prepares the same multipart upload the browser uses and, after answering, copies the file from Drive part by part (HTTP ranges of 16 MB) into the worker's presigned URLs. The worker transcribes it as any upload.
4. **Board.** The file shows as a card in the board's Material lane, with its state: Transcrevendo, Pronto or Erro na transcrição (`GET /api/reporter/drive/received`).
5. **Nova produção.** Opening the card opens Nova produção (`/productions/new?material=<id>`) with the file already on "Arquivo", its progress and analysis as an upload's. The steps are the manual ones: speakers, authorization, then the pauta. The subfolder's format comes chosen. "Gerar" creates the production; the card then leaves the lane.
6. **Prontos / Erro.** Once transcribed, the script moves the file to `Prontos`, with that Nova produção link in the file's description, or to `Erro`, with the reason.

Every step is idempotent per Drive file: the ids and the upload token are derived from the file id and the secret, so a repeated sync replays instead of duplicating. To try a failed file again, make a copy of it in `Entrada`.

## Setup

**Vercel (Production):**

- `REPORTER_DRIVE_SECRET`: a random value of 32 or more characters, for example `openssl rand -base64 32`.
- `REPORTER_DRIVE_OWNER_EMAIL`: the member (editor or admin) the intake uploads as.

**Google:**

1. Open the event folder, then **Extensions → Apps Script**. If that menu is missing, use [script.google.com](https://script.google.com) → New project, signed in as the folder owner.
2. Paste `integrations/google-drive/Code.gs` into `Code.gs`. If the folder changes, also change `ROOT_FOLDER_ID`.
3. In **Project Settings → Script Properties**, add:
   - `REPORTER_URL`: the Reporter IA address people use, for example `https://reporter-ai-three.vercel.app`. The worker accepts uploads only from its configured app origins.
   - `REPORTER_DRIVE_SECRET`: the same value as in Vercel.
4. Run `setup` once and authorize it. It creates the four subfolders and the one-minute trigger. Its log reads "Pronto".

The executions log in Apps Script shows each file's stage. The app logs only error codes (`drive_upload_failed`).

## Security

- Without `REPORTER_DRIVE_SECRET`, the route answers 404. The secret is compared in constant time.
- The Drive token lives about an hour and is used only in memory, for that file's download. It is never stored or logged.
- The database function `reporter_service_context` (migration 021) finds the configured member by email. It is read-only and granted only to the app's runtime role.
- Migration 022 records each received file (`reporter_drive_intakes`). The board lists those that no production uses yet, from the last 30 days.
