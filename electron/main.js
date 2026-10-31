'use strict'

const { app, BrowserWindow, ipcMain, globalShortcut, session, shell, protocol, net, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const store = require('./settings')
const secrets = require('./secrets')
const { ObsManager, RENDERER_OBS_ALLOWED } = require('./obs')
const { runCommand, complete } = require('./agent')
const { ChatService } = require('./chat')
const { OverlayServer } = require('./overlay')
const { MusicService } = require('./music')

const DEV_URL = process.env.SONA_DEV_URL || ''
let win = null

function emit(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'sona-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: false } }
])

const obs = new ObsManager(emit)

const chat = new ChatService({
  emit,
  getSettings: () => store.get(),
  saveChat: (patch) => store.save({ chat: { ...store.get().chat, ...patch } }),
  getObs: () => obs,
  aiComplete: ({ system, user }) => complete(store.get().ai, { system, user })
})

const overlay = new OverlayServer({
  getSettings: () => store.get(),
  saveOverlay: (patch) => store.save({ overlay: { ...store.get().overlay, ...patch } }),
  getChat: () => chat,
  getMusic: () => music,
  getObs: () => obs
})

const music = new MusicService({
  getSettings: () => store.get(),
  saveMusic: (patch) => store.save({ music: { ...store.get().music, ...patch } }),
  emit
})

/* ------------------------------- OBS autodetect ---------------------------- */

function detectObs() {
  const candidates = [
    path.join(process.env.APPDATA ?? '', 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json'),
    path.join(process.env.HOME ?? '', '.config', 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json')
  ]
  for (const file of candidates) {
    if (!file || !fs.existsSync(file)) continue
    try {
      const cfg = JSON.parse(fs.readFileSync(file, 'utf8'))
      return {
        found: true,
        file,
        enabled: Boolean(cfg.server_enabled ?? cfg.ServerEnabled),
        port: Number(cfg.server_port ?? cfg.ServerPort ?? 4455),
        password: String(cfg.server_password ?? cfg.ServerPassword ?? ''),
        authRequired: Boolean(cfg.auth_required ?? cfg.AuthRequired)
      }
    } catch {
      /* try next */
    }
  }
  return { found: false }
}

/* --------------------------------- window --------------------------------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 960,
    minHeight: 620,
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
      fs.writeFileSync(process.env.SONA_SHOT, image.toPNG())
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
  else if (process.env.SONA_TAB) win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: { tab: process.env.SONA_TAB } })
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

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'))
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media')

  protocol.handle('sona-media', async (request) => {
    const url = new URL(request.url)
    const id = decodeURIComponent(url.pathname.replace(/^\//, ''))
    const item = (store.get().music.items ?? []).find((i) => i.id === id)
    if (!item?.path || !fs.existsSync(item.path)) return new Response('not found', { status: 404 })
    return net.fetch(pathToFileURL(item.path).toString())
  })

  createWindow()
  registerHotkey()

  const cfg = store.get()
  if (cfg.overlay.enabled) overlay.start(cfg.overlay.port).catch(() => {})
  if (cfg.obs.autoConnect && cfg.obs.url) {
    const password = secrets.get('obsPassword')
    obs.connect({ url: cfg.obs.url, password }).catch(() => {})
  }
  if (cfg.chat.enabled && cfg.chat.channel) {
    chat.connect({ channel: cfg.chat.channel, username: cfg.chat.username, token: secrets.get('twitchToken') })
  }
  chat.armTimers()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  overlay.stop().catch(() => {})
})

/* ------------------------------- settings ------------------------------- */

ipcMain.handle('settings:get', () => {
  const cfg = store.get()
  return { ...cfg, secrets: store.secretStatus() }
})
ipcMain.handle('settings:save', (_e, patch) => {
  const next = store.save(patch)
  registerHotkey()
  return { ...next, secrets: store.secretStatus() }
})
ipcMain.handle('settings:path', () => store.file())

ipcMain.handle('secrets:save', (_e, patch) => {
  const res = store.saveSecrets(patch)
  return { ...res, status: store.secretStatus() }
})
ipcMain.handle('secrets:status', () => store.secretStatus())
ipcMain.handle('secrets:clear', () => {
  secrets.clear()
  return store.secretStatus()
})

/* ---------------------------------- obs --------------------------------- */

ipcMain.handle('obs:detect', () => detectObs())

ipcMain.handle('obs:connect', async (_e, cfg) => {
  const merged = { ...store.get().obs, ...(cfg ?? {}) }
  const password = String(cfg?.password ?? '') || secrets.get('obsPassword')
  if (cfg?.password) secrets.set({ obsPassword: cfg.password })
  store.save({ obs: { url: merged.url, autoConnect: merged.autoConnect, autoDetect: merged.autoDetect } })
  return obs.connect({ url: merged.url, password })
})

ipcMain.handle('obs:disconnect', () => obs.disconnect())
ipcMain.handle('obs:status', () => obs.statusInfo())
ipcMain.handle('obs:snapshot', () => obs.refresh())
ipcMain.handle('obs:undo', () => obs.undo())
ipcMain.handle('obs:call', async (_e, payload) => {
  const requestType = String(payload?.requestType ?? '')
  if (!RENDERER_OBS_ALLOWED.has(requestType)) {
    return { ok: false, error: `request_type_not_allowed: ${requestType}` }
  }
  return obs.call(requestType, payload?.requestData ?? {})
})

/* ----------------------------------- ai ---------------------------------- */

ipcMain.handle('ai:command', async (_e, payload) => {
  const text = String(payload?.text ?? '').trim()
  if (!text) return { ok: false, error: 'empty_command' }
  try {
    const result = await runCommand({
      obs,
      context: { chat, overlay, music },
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
      headers: { Authorization: `Bearer ${cfg.apiKey || secrets.get('aiKey') || 'local'}` }
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const body = await res.json().catch(() => ({}))
    const models = (body?.data ?? []).map((m) => m.id).filter(Boolean).slice(0, 60)
    return { ok: true, models }
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) }
  }
})

/* ---------------------------------- stt ---------------------------------- */

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
      headers: { Authorization: `Bearer ${cfg.apiKey || secrets.get('sttKey') || 'local'}` },
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

/* ---------------------------------- chat --------------------------------- */

ipcMain.handle('chat:connect', (_e, cfg) => {
  const token = String(cfg?.token ?? '') || secrets.get('twitchToken')
  if (cfg?.token) secrets.set({ twitchToken: cfg.token })
  store.save({
    chat: {
      ...store.get().chat,
      channel: String(cfg?.channel ?? store.get().chat.channel),
      username: String(cfg?.username ?? store.get().chat.username),
      enabled: true
    }
  })
  return chat.connect({ channel: cfg?.channel, username: cfg?.username, token })
})

ipcMain.handle('chat:disconnect', () => chat.disconnect())
ipcMain.handle('chat:state', () => ({ ...chat.state(), recent: chat.recent(40), poll: chat.pollState(), giveaway: chat.giveawayState() }))
ipcMain.handle('chat:send', (_e, text) => chat.send(text))
ipcMain.handle('chat:poll', (_e, payload) => (payload?.stop ? chat.stopPoll() : chat.startPoll(payload ?? {})))
ipcMain.handle('chat:giveaway', (_e, payload) => (payload?.stop ? chat.pickWinner() : chat.startGiveaway(payload ?? {})))
ipcMain.handle('chat:counter', (_e, payload) => chat.counter(payload?.name, payload?.value))
ipcMain.handle('chat:timer', (_e, payload) => {
  if (payload?.action === 'remove') return chat.removeTimer(payload.id)
  if (payload?.action === 'toggle') return chat.setTimerEnabled(payload.id, payload.enabled)
  return chat.addTimer(payload?.text, payload?.intervalMin)
})

/* -------------------------------- overlay -------------------------------- */

ipcMain.handle('overlay:start', () => overlay.start(store.get().overlay.port))
ipcMain.handle('overlay:stop', () => overlay.stop())
ipcMain.handle('overlay:state', () => ({
  running: overlay.running,
  url: overlay.url(),
  port: overlay.port,
  elements: store.get().overlay.elements ?? []
}))
ipcMain.handle('overlay:update', (_e, elements) => {
  const res = overlay.updateElements(elements)
  store.save({ overlay: { ...store.get().overlay, elements } })
  return res
})
ipcMain.handle('overlay:alert', (_e, payload) => overlay.fireAlert(payload ?? {}))
ipcMain.handle('overlay:pickImage', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Pilih gambar overlay',
    filters: [{ name: 'Gambar', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    properties: ['openFile']
  })
  if (result.canceled || !result.filePaths[0]) return { ok: false, error: 'canceled' }
  const src = result.filePaths[0]
  const name = path.basename(src)
  const dest = path.join(overlay.assetsDir(), name)
  fs.copyFileSync(src, dest)
  overlay.broadcast()
  return { ok: true, src: `/assets/${encodeURIComponent(name)}`, name }
})

/* --------------------------------- music --------------------------------- */

ipcMain.handle('music:state', () => music.state())
ipcMain.handle('music:addFiles', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Tambah musik',
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'opus', 'aac'] }],
    properties: ['openFile', 'multiSelections']
  })
  if (result.canceled) return { ok: false, error: 'canceled' }
  return music.addLocal(result.filePaths)
})
ipcMain.handle('music:addPath', (_e, paths) => music.addLocal(Array.isArray(paths) ? paths : [paths]))
ipcMain.handle('music:play', (_e, query) => music.play(query))
ipcMain.handle('music:pause', () => music.pause())
ipcMain.handle('music:next', () => music.next())
ipcMain.handle('music:previous', () => music.previous())
ipcMain.handle('music:jump', (_e, index) => music.jump(index))
ipcMain.handle('music:volume', (_e, percent) => music.setVolume(percent))
ipcMain.handle('music:loop', (_e, mode) => music.setLoop(mode))
ipcMain.handle('music:shuffle', (_e, on) => music.setShuffle(on))
ipcMain.handle('music:sink', (_e, sinkId) => music.setSink(sinkId))
ipcMain.handle('music:clear', () => music.clear())
ipcMain.handle('music:remove', (_e, id) => music.remove(id))
ipcMain.handle('music:ended', () => music.next())
ipcMain.handle('music:setPlaying', (_e, value) => music.setPlaying(value))

/* ---------------------------------- misc --------------------------------- */

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  platform: process.platform,
  settingsPath: store.file(),
  overlayUrl: overlay.url(),
  secretsAvailable: secrets.available()
}))

ipcMain.handle('app:openExternal', (_e, url) => {
  if (!/^https?:/i.test(String(url))) return { ok: false }
  shell.openExternal(String(url))
  return { ok: true }
})
