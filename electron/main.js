'use strict'

const { app, BrowserWindow, ipcMain, globalShortcut, session, shell } = require('electron')
const path = require('node:path')

const store = require('./settings')
const { ObsManager } = require('./obs')
const { runCommand } = require('./agent')

const DEV_URL = process.env.SONA_DEV_URL || ''
let win = null

function emit(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

const obs = new ObsManager(emit)

/** OBS request types the renderer may issue directly. Everything else goes through the agent. */
const RENDERER_OBS_ALLOWED = new Set([
  'GetSceneList',
  'GetSceneItemList',
  'GetInputList',
  'GetInputVolume',
  'GetInputMute',
  'SetInputVolume',
  'SetInputMute',
  'ToggleInputMute',
  'SetCurrentProgramScene',
  'GetCurrentProgramScene',
  'SetSceneItemEnabled',
  'GetSceneItemId',
  'GetStreamStatus',
  'StartStream',
  'StopStream',
  'GetRecordStatus',
  'StartRecord',
  'StopRecord',
  'GetVirtualCamStatus',
  'StartVirtualCam',
  'StopVirtualCam',
  'TriggerStudioModeTransition',
  'GetVersion'
])

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0b0d',
    title: 'Sona',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win.show())

  if (process.env.SONA_DEBUG) {
    win.webContents.on('console-message', (_event, level, message) => console.log(`[renderer:${level}]`, message))
    win.webContents.on('did-fail-load', (_event, code, description, url) =>
      console.error('[load-fail]', code, description, url)
    )
  }

  // Dev smoke test: SONA_SHOT=<path.png> renders once, saves a screenshot, quits.
  if (process.env.SONA_SHOT) {
    win.webContents.once('did-finish-load', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      const image = await win.webContents.capturePage()
      require('node:fs').writeFileSync(process.env.SONA_SHOT, image.toPNG())
      app.quit()
    })
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = DEV_URL && url.startsWith(DEV_URL)
    if (!allowed && !url.startsWith('file://')) event.preventDefault()
  })

  if (DEV_URL) win.loadURL(DEV_URL)
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))

  win.on('closed', () => {
    win = null
  })
}

function registerHotkey() {
  globalShortcut.unregisterAll()
  const hotkey = store.get().voice.hotkey
  if (!hotkey) return { ok: true, registered: false }
  try {
    const ok = globalShortcut.register(hotkey, () => emit('voice:hotkey'))
    return { ok, registered: ok }
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) }
  }
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'))

  createWindow()
  registerHotkey()

  const cfg = store.get()
  if (cfg.obs.autoConnect && cfg.obs.url) {
    obs.connect(cfg.obs).catch(() => {})
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => globalShortcut.unregisterAll())

/* ------------------------------- settings ------------------------------- */

ipcMain.handle('settings:get', () => store.get())
ipcMain.handle('settings:save', (_e, patch) => {
  const next = store.save(patch)
  registerHotkey()
  return next
})
ipcMain.handle('settings:path', () => store.file())

/* --------------------------------- obs ---------------------------------- */

ipcMain.handle('obs:connect', async (_e, cfg) => {
  const merged = { ...store.get().obs, ...(cfg ?? {}) }
  store.save({ obs: merged })
  return obs.connect(merged)
})

ipcMain.handle('obs:disconnect', () => obs.disconnect())
ipcMain.handle('obs:status', () => obs.statusInfo())
ipcMain.handle('obs:snapshot', () => obs.refresh())
ipcMain.handle('obs:call', async (_e, payload) => {
  const requestType = String(payload?.requestType ?? '')
  if (!RENDERER_OBS_ALLOWED.has(requestType)) {
    return { ok: false, error: `request_type_not_allowed: ${requestType}` }
  }
  return obs.call(requestType, payload?.requestData ?? {})
})

/* ---------------------------------- ai ---------------------------------- */

ipcMain.handle('ai:command', async (_e, payload) => {
  const text = String(payload?.text ?? '').trim()
  if (!text) return { ok: false, error: 'empty_command' }
  try {
    const result = await runCommand({
      obs,
      cfg: store.get().ai,
      text,
      history: Array.isArray(payload?.history) ? payload.history : [],
      onStep: (step) => emit('ai:step', step)
    })
    return { ok: true, ...result }
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) }
  }
})

ipcMain.handle('ai:test', async () => {
  const cfg = store.get().ai
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '')
  if (!base) return { ok: false, error: 'base_url_empty' }
  try {
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${cfg.apiKey || 'local'}` }
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const body = await res.json().catch(() => ({}))
    const models = (body?.data ?? []).map((m) => m.id).filter(Boolean).slice(0, 40)
    return { ok: true, models }
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) }
  }
})

/* --------------------------------- stt ---------------------------------- */

ipcMain.handle('stt:transcribe', async (_e, payload) => {
  const cfg = store.get().stt
  if (!cfg.enabled) return { ok: false, error: 'stt_disabled' }
  const bytes = payload?.buffer
  if (!bytes || !bytes.byteLength) return { ok: false, error: 'empty_audio' }

  const base = String(cfg.baseUrl || '').replace(/\/+$/, '')
  const form = new FormData()
  form.append('file', new Blob([Buffer.from(bytes)], { type: payload.mime || 'audio/webm' }), 'speech.webm')
  form.append('model', cfg.model || 'whisper-1')
  if (cfg.language) form.append('language', cfg.language)

  try {
    const res = await fetch(`${base}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey || 'local'}` },
      body: form
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` }
    }
    const body = await res.json().catch(() => ({}))
    return { ok: true, text: String(body?.text ?? '').trim() }
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) }
  }
})

/* --------------------------------- misc --------------------------------- */

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  platform: process.platform,
  settingsPath: store.file()
}))

ipcMain.handle('app:openExternal', (_e, url) => {
  if (!/^https?:/i.test(String(url))) return { ok: false }
  shell.openExternal(String(url))
  return { ok: true }
})
