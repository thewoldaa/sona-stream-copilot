'use strict'

const { app, BrowserWindow, ipcMain, globalShortcut, session, shell, protocol, net, dialog, screen } = require('electron')
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
const { Notch } = require('./notch')

const DEV_URL = process.env.SONA_DEV_URL || ''
let win = null

function emit(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  if (
    channel === 'obs:snapshot' ||
    channel === 'obs:status' ||
    channel === 'chat:message' ||
    channel === 'chat:state' ||
    channel === 'chat:poll' ||
    channel === 'chat:giveaway' ||
    channel === 'music:state'
  ) {
    try {
      notchRef?.broadcast()
    } catch {
      /* notch is optional */
    }
  }
}

let notchRef = null

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

const notch = new Notch({
  getSettings: () => store.get(),
  save: (patch) => store.save({ notch: { ...store.get().notch, ...patch } }),
  getObs: () => obs,
  getChat: () => chat,
  getMusic: () => music,
  getOverlay: () => overlay,
  getAi: () => store.get().ai
})

notchRef = notch

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
      if (orbWin && !orbWin.isDestroyed()) {
        try {
          const orbImage = await orbWin.webContents.capturePage()
          fs.writeFileSync(`${process.env.SONA_SHOT}.orb.png`, orbImage.toPNG())
        } catch {
          /* orb capture is best effort */
        }
      }
      const notchWindow = notch.window
      if (notchWindow) {
        try {
          if (process.env.SONA_NOTCH_EXPAND) {
            notch.setExpanded(true)
            await new Promise((resolve) => setTimeout(resolve, 900))
          }
          const notchImage = await notchWindow.webContents.capturePage()
          fs.writeFileSync(`${process.env.SONA_SHOT}.notch.png`, notchImage.toPNG())
        } catch {
          /* notch capture is best effort */
        }
      }
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

/* ---------------------------------- orb ----------------------------------- */

let orbWin = null

function orbPosition() {
  const cfg = store.get().orb
  const size = Number(cfg.size) || 132
  const margin = 24
  if (Number.isFinite(cfg.x) && Number.isFinite(cfg.y)) return { x: Math.round(cfg.x), y: Math.round(cfg.y) }
  const { workArea } = screen.getPrimaryDisplay()
  const corners = {
    br: { x: workArea.x + workArea.width - size - margin, y: workArea.y + workArea.height - size - margin },
    bl: { x: workArea.x + margin, y: workArea.y + workArea.height - size - margin },
    tr: { x: workArea.x + workArea.width - size - margin, y: workArea.y + margin },
    tl: { x: workArea.x + margin, y: workArea.y + margin }
  }
  return corners[cfg.corner] ?? corners.br
}

function createOrb() {
  if (orbWin && !orbWin.isDestroyed()) return orbWin
  const cfg = store.get().orb
  const size = Number(cfg.size) || 132
  const pos = orbPosition()

  orbWin = new BrowserWindow({
    width: size,
    height: size + 44,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  orbWin.setAlwaysOnTop(true, 'screen-saver')
  if (typeof orbWin.setVisibleOnAllWorkspaces === 'function') orbWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (DEV_URL) orbWin.loadURL(`${DEV_URL}?win=orb`)
  else orbWin.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: { win: 'orb' } })

  orbWin.once('ready-to-show', () => {
    if (store.get().orb.visible) orbWin.showInactive()
  })
  let moveTimer = null
  orbWin.on('moved', () => {
    clearTimeout(moveTimer)
    moveTimer = setTimeout(() => {
      if (!orbWin || orbWin.isDestroyed()) return
      const [x, y] = orbWin.getPosition()
      store.save({ orb: { ...store.get().orb, x, y, corner: null } })
    }, 450)
  })
  orbWin.on('closed', () => {
    orbWin = null
  })
  return orbWin
}

function destroyOrb() {
  if (orbWin && !orbWin.isDestroyed()) orbWin.destroy()
  orbWin = null
  return { ok: true }
}

function orbSend(channel, payload) {
  if (orbWin && !orbWin.isDestroyed()) orbWin.webContents.send(channel, payload)
}

function registerHotkey() {  globalShortcut.unregisterAll()
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
  if (cfg.orb.enabled) createOrb()
  if (cfg.notch.enabled) notch.create()
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

/* -------------------------------- onboarding ---------------------------- */

ipcMain.handle('onboarding:save', (_e, patch) => {
  const next = store.save({ onboarding: { ...store.get().onboarding, ...(patch ?? {}) } })
  return next.onboarding
})

/* ---------------------------------- orb ---------------------------------- */

ipcMain.handle('orb:state', () => ({
  enabled: store.get().orb.enabled,
  visible: Boolean(orbWin && !orbWin.isDestroyed() && orbWin.isVisible()),
  corner: store.get().orb.corner,
  position: orbWin && !orbWin.isDestroyed() ? orbWin.getPosition() : null
}))

ipcMain.handle('orb:toggle', (_e, enabled) => {
  const on = Boolean(enabled)
  store.save({ orb: { ...store.get().orb, enabled: on } })
  if (on) createOrb()
  else destroyOrb()
  return { ok: true, enabled: on }
})

ipcMain.handle('orb:visibility', (_e, visible) => {
  const on = Boolean(visible)
  store.save({ orb: { ...store.get().orb, visible: on } })
  if (!orbWin || orbWin.isDestroyed()) {
    if (on) createOrb()
    return { ok: true, visible: on }
  }
  if (on) orbWin.showInactive()
  else orbWin.hide()
  return { ok: true, visible: on }
})

ipcMain.handle('orb:snap', (_e, corner) => {
  if (!orbWin || orbWin.isDestroyed()) return { ok: false, error: 'orb_off' }
  const size = Number(store.get().orb.size) || 132
  const { workArea } = screen.getPrimaryDisplay()
  const margin = 24
  const map = {
    br: { x: workArea.x + workArea.width - size - margin, y: workArea.y + workArea.height - size - margin },
    bl: { x: workArea.x + margin, y: workArea.y + workArea.height - size - margin },
    tr: { x: workArea.x + workArea.width - size - margin, y: workArea.y + margin },
    tl: { x: workArea.x + margin, y: workArea.y + margin }
  }
  const target = map[corner] ?? map.br
  orbWin.setPosition(Math.round(target.x), Math.round(target.y))
  store.save({ orb: { ...store.get().orb, x: Math.round(target.x), y: Math.round(target.y), corner } })
  return { ok: true, corner }
})

ipcMain.handle('orb:setState', (_e, state) => {
  orbSend('orb:state', state)
  if (win && !win.isDestroyed()) win.webContents.send('orb:state', state)
  return { ok: true }
})

ipcMain.handle('orb:popup', (_e, payload) => {
  if (!store.get().orb.popups) return { ok: false, error: 'popups_off' }
  orbSend('orb:popup', payload)
  return { ok: true }
})

ipcMain.handle('orb:voiceToggle', () => {
  emit('voice:hotkey')
  return { ok: true }
})

ipcMain.handle('orb:hide', () => {
  store.save({ orb: { ...store.get().orb, visible: false } })
  if (orbWin && !orbWin.isDestroyed()) orbWin.hide()
  return { ok: true }
})

/* ---------------------------------- notch -------------------------------- */

ipcMain.handle('notch:state', () => ({
  ...notch.snapshot(),
  enabled: store.get().notch.enabled,
  visible: store.get().notch.visible
}))

ipcMain.handle('notch:toggle', (_e, enabled) => {
  const on = Boolean(enabled)
  store.save({ notch: { ...store.get().notch, enabled: on } })
  if (on) notch.create()
  else notch.destroy()
  return { ok: true, enabled: on }
})

ipcMain.handle('notch:expand', (_e, expanded) => notch.setExpanded(expanded !== false))

ipcMain.handle('notch:visibility', (_e, visible) => {
  notch.show(Boolean(visible))
  return { ok: true, visible: Boolean(visible) }
})

ipcMain.handle('notch:action', async (_e, payload) => {
  const type = String(payload?.type ?? '')
  const goTab = (tab) => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      win.webContents.send('app:nav', tab)
    }
    return { ok: true, tab }
  }

  switch (type) {
    case 'main':
      return goTab('dashboard')
    case 'settings':
      return goTab('settings')
    case 'chat':
      return goTab('chat')
    case 'overlay':
      return goTab('overlay')
    case 'music':
      return goTab('music')
    case 'assistant':
      return goTab('assistant')

    case 'stream': {
      if (!obs.connected) return { ok: false, error: 'obs_offline' }
      const res = await obs.call(obs.snapshot.streaming ? 'StopStream' : 'StartStream')
      obs.refreshSoon()
      return res
    }

    case 'microphone': {
      if (!obs.connected) return { ok: false, error: 'obs_offline' }
      const mic = (obs.snapshot.audio ?? []).find((a) => /mic|microphone|aux/i.test(a.name)) ?? obs.snapshot.audio?.[0]
      if (!mic) return { ok: false, error: 'no_audio_input' }
      const res = await obs.call('SetInputMute', { inputName: mic.name, inputMuted: !mic.muted })
      obs.refreshSoon()
      return { ...res, input: mic.name, muted: !mic.muted }
    }

    case 'alert': {
      overlay.fireAlert({ user: 'Penonton', kind: 'follow' })
      return { ok: true }
    }

    case 'voice': {
      emit('voice:hotkey')
      return { ok: true }
    }

    case 'collapse':
      return notch.setExpanded(false)

    case 'hide':
      notch.show(false)
      return { ok: true }
  }
  return { ok: false, error: `unknown_action: ${type}` }
})

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
