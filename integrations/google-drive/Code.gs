/**
 * Reporter IA · Drive folder intake (Google Apps Script).
 *
 * Runs every minute on Google's servers, as the account that owns the event folder. Files
 * dropped in "Entrada" (or in a subfolder named after a format: Estande, Painel, Premiação,
 * Abertura, Nota) move to "Processando" and are synced with Reporter IA, which copies them
 * from Drive and transcribes them; each then waits on the board's Material lane for Nova produção.
 * Each file ends in "Prontos" (its description links Nova produção with it) or in "Erro" (its
 * description says why).
 *
 * Setup: Project Settings → Script Properties
 *   REPORTER_URL           https://<the Reporter IA address>
 *   REPORTER_DRIVE_SECRET  the same value as REPORTER_DRIVE_SECRET in Vercel
 * then run `setup` once and authorize. See docs/DRIVE_INTAKE.md.
 */

const ROOT_FOLDER_ID = '1o1waqxjwIY22EoREIm6covJ2e1_t_BCb';
const FOLDERS = { inbox: 'Entrada', processing: 'Processando', done: 'Prontos', failed: 'Erro' };
const MAX_UPLOAD_TRIES = 3;
const MAX_ERRORS = 10;
const TICK_BUDGET_MS = 4.5 * 60 * 1000;

function setup() {
  config_();
  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  Object.values(FOLDERS).forEach(name => child_(root, name));
  ScriptApp.getProjectTriggers().filter(trigger => trigger.getHandlerFunction() === 'tick').forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(1).create();
  console.log('Pronto: a pasta é verificada a cada minuto.');
  tick();
}

function tick() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  const started = Date.now();
  try {
    const settings = config_();
    const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
    const folders = Object.fromEntries(Object.entries(FOLDERS).map(([key, name]) => [key, child_(root, name)]));
    const inbox = folders.inbox;
    // New files: remember where they came from, then move them out of the inbox.
    const arrivals = [...files_(inbox).map(file => [file, '']),
      ...folderList_(inbox).flatMap(folder => files_(folder).map(file => [file, folder.getName()]))];
    for (const [file, format] of arrivals) {
      const media = target_(file);
      save_(file.getId(), { mediaId: media.getId(), name: media.getName(), size: media.getSize(), folder: format,
        recordedOn: Utilities.formatDate(media.getDateCreated(), 'America/Sao_Paulo', 'yyyy-MM-dd'), next: 0, uploads: 0, errors: 0 });
      file.moveTo(folders.processing);
      console.log(`Recebido: ${media.getName()}${format ? ` (${format})` : ''}`);
    }
    for (const file of files_(folders.processing)) {
      if (Date.now() - started > TICK_BUDGET_MS) break;
      const state = load_(file.getId());
      if (state.next > Date.now()) continue;
      sync_(settings, file, state, folders);
    }
  } finally {
    lock.releaseLock();
  }
}

function sync_(settings, file, state, folders) {
  const payload = { fileId: state.mediaId, name: state.name, size: state.size, recordedOn: state.recordedOn,
    accessToken: ScriptApp.getOAuthToken(), ...(state.folder ? { folder: state.folder } : {}) };
  let status = 0, body = {};
  try {
    const response = UrlFetchApp.fetch(`${settings.url}/api/reporter/drive/sync`, { method: 'post', contentType: 'application/json',
      headers: { authorization: `Bearer ${settings.secret}` }, payload: JSON.stringify(payload), muteHttpExceptions: true });
    status = response.getResponseCode();
    try { body = JSON.parse(response.getContentText()); } catch (error) { body = {}; }
  } catch (error) {
    status = 0;
  }
  if (status === 401) throw new Error('O Reporter IA recusou o segredo. Confira REPORTER_DRIVE_SECRET aqui e na Vercel.');
  if (status === 200 || status === 202) {
    if (body.stage === 'ready') return finish_(file, folders.done, `Reporter IA: ${body.url}`, `Pronto: ${state.name} → ${body.url}`);
    if (body.stage === 'failed') return finish_(file, folders.failed, `Reporter IA: ${body.error || 'TRANSCRIPTION_FAILED'}`, `Erro: ${state.name} (${body.error})`);
    if (body.stage === 'uploading' && ++state.uploads > MAX_UPLOAD_TRIES) return finish_(file, folders.failed, 'Reporter IA: UPLOAD_FAILED', `Erro: ${state.name} não foi copiado`);
    state.errors = 0;
    state.next = Date.now() + (Number(body.retryAfter) || 60) * 1000;
    console.log(`${state.name}: ${body.stage}${body.progress !== undefined ? ` ${body.progress}%` : ''}`);
    return save_(file.getId(), state);
  }
  // A refused file will never be accepted; anything else is retried for a while.
  if ([400, 413, 415, 422].includes(status)) return finish_(file, folders.failed, `Reporter IA: ${body.error || `HTTP_${status}`}`, `Erro: ${state.name} (${body.error || status})`);
  if (++state.errors >= MAX_ERRORS) return finish_(file, folders.failed, `Reporter IA: ${body.error || `HTTP_${status}`}`, `Erro: ${state.name} (${body.error || status})`);
  state.next = Date.now() + 2 * 60 * 1000;
  console.warn(`${state.name}: tentando de novo (${body.error || status})`);
  save_(file.getId(), state);
}

function finish_(file, folder, description, message) {
  file.setDescription(description);
  file.moveTo(folder);
  PropertiesService.getScriptProperties().deleteProperty(`file:${file.getId()}`);
  console.log(message);
}

function config_() {
  const properties = PropertiesService.getScriptProperties();
  const url = (properties.getProperty('REPORTER_URL') || '').trim().replace(/\/+$/, '');
  const secret = (properties.getProperty('REPORTER_DRIVE_SECRET') || '').trim();
  if (!/^https:\/\//.test(url) || secret.length < 32) throw new Error('Defina REPORTER_URL (https) e REPORTER_DRIVE_SECRET (32+ caracteres) nas propriedades do script.');
  return { url, secret };
}

function child_(parent, name) {
  const found = parent.getFoldersByName(name);
  return found.hasNext() ? found.next() : parent.createFolder(name);
}

function files_(folder) {
  const list = [], iterator = folder.getFiles();
  while (iterator.hasNext()) list.push(iterator.next());
  return list;
}

function folderList_(folder) {
  const list = [], iterator = folder.getFolders();
  while (iterator.hasNext()) list.push(iterator.next());
  return list;
}

/** A shortcut is synced as the file it points to; the shortcut itself is what moves. */
function target_(file) {
  return file.getMimeType() === MimeType.SHORTCUT ? DriveApp.getFileById(file.getTargetId()) : file;
}

function load_(id) {
  const value = PropertiesService.getScriptProperties().getProperty(`file:${id}`);
  if (value) return JSON.parse(value);
  // A file moved into "Processando" by hand: take it as it is.
  const file = DriveApp.getFileById(id), media = target_(file);
  return { mediaId: media.getId(), name: media.getName(), size: media.getSize(), folder: '',
    recordedOn: Utilities.formatDate(media.getDateCreated(), 'America/Sao_Paulo', 'yyyy-MM-dd'), next: 0, uploads: 0, errors: 0 };
}

function save_(id, state) {
  PropertiesService.getScriptProperties().setProperty(`file:${id}`, JSON.stringify(state));
}
