'use strict'

const { BrowserWindow, screen } = require('electron')
const path = require('node:path')

const COLLAPSED = { width: 440, height: 62 }
const EXPANDED = { width: 772, height: 404 }

/**
 * The notch: a transparent bar pinned to the top-centre of the primary display
 * that expands into a control panel. Modelled on the analysed app's `?win=notch`
 * window (14 IPC channels), rebuilt with Sona's own mark and its own data.
 */
class Notch {
  #win = null
  #getSettings
  #save
  #getObs
  #getChat
  #getMusic
  #getOverlay
  #getAi
  #bitrate = null
  #lastBytes = null
  #lastBytesAt = 0
  #ticker = null
  expanded = false

  constructor({ getSettings, save, getObs, getChat, getMusic, getOverlay, getAi }) {
    this.#getSettings = getSettings
    this.#save = save ?? (() => {})
    this.#getObs = getObs
    this.#getChat = getChat
    this.#getMusic = getMusic
    this.#getOverlay = getOverlay
    this.#getAi = getAi
  }

  get running() {
    return Boolean(this.#win && !this.#win.isDestroyed())
  }

  get window() {
    return this.running ? this.#win : null
  }

  #bounds() {
    const size = this.expanded ? EXPANDED : COLLAPSED
    const { workArea } = screen.getPrimaryDisplay()
    const x = Math.round(workArea.x + (workArea.width - size.width) / 2)
    const y = Math.round(workArea.y - 6)
    return { x, y, ...size }
  }

  create() {
    if (this.running) return this.#win
    const bounds = this.#bounds()

    this.#win = new BrowserWindow({
      ...bounds,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      focusable: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })

    this.#win.setAlwaysOnTop(true, 'screen-saver')
    if (typeof this.#win.setVisibleOnAllWorkspaces === 'function') {
      this.#win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    }

    const devUrl = process.env.SONA_DEV_URL || ''
    if (devUrl) this.#win.loadURL(`${devUrl}?win=notch`)
    else this.#win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: { win: 'notch' } })

    this.#win.once('ready-to-show', () => {
      if (this.#getSettings().notch.visible) this.#win.showInactive()
      this.#win.setAlwaysOnTop(true, 'screen-saver')
      this.broadcast()
    })
    this.#win.on('closed', () => {
      this.#win = null
    })

    clearInterval(this.#ticker)
    this.#ticker = setInterval(() => this.broadcast(), 4000)
    return this.#win
  }

  destroy() {
    clearInterval(this.#ticker)
    this.#ticker = null
    if (this.#win && !this.#win.isDestroyed()) this.#win.destroy()
    this.#win = null
    return { ok: true }
  }

  show(visible = true) {
    this.#save({ visible: Boolean(visible) })
    if (!this.running && visible) this.create()
    if (!this.running) return { ok: true, visible: Boolean(visible) }
    if (visible) this.#win.showInactive()
    else this.#win.hide()
    return { ok: true, visible: Boolean(visible) }
  }

  setExpanded(expanded) {
    this.expanded = Boolean(expanded)
    this.#save({ expanded: this.expanded })
    if (!this.running) return { ok: false, error: 'notch_off' }
    this.#win.setBounds(this.#bounds())
    this.broadcast()
    return { ok: true, expanded: this.expanded }
  }

  toggleExpanded() {
    return this.setExpanded(!this.expanded)
  }

  /** Bitrate needs two samples of outputBytes; sampled on the broadcast tick. */
  #sampleBitrate(stream) {
    if (!stream?.active || !Number.isFinite(stream.bytes)) {
      this.#bitrate = null
      this.#lastBytes = null
      return null
    }
    const now = Date.now()
    if (this.#lastBytes != null && now > this.#lastBytesAt) {
      const deltaBits = (stream.bytes - this.#lastBytes) * 8
      const seconds = (now - this.#lastBytesAt) / 1000
      if (seconds > 1) this.#bitrate = Math.max(0, Math.round(deltaBits / seconds / 1000))
    }
    this.#lastBytes = stream.bytes
    this.#lastBytesAt = now
    return this.#bitrate
  }

  snapshot() {
    const obs = this.#getObs?.()
    const chat = this.#getChat?.()
    const music = this.#getMusic?.()
    const overlay = this.#getOverlay?.()
    const settings = this.#getSettings()
    const snap = obs?.snapshot ?? {}

    const bitrate = this.#sampleBitrate({ active: Boolean(snap.streaming), bytes: snap.streamBytes })

    const now = Date.now()
    const recent = chat?.recent?.(120) ?? []
    const messagesLastMinute = recent.filter((m) => now - (m.at ?? 0) < 60_000).length
    const timers = (settings.chat?.timers ?? []).filter((t) => t.enabled).length

    return {
      at: now,
      expanded: this.expanded,
      obs: {
        connected: Boolean(obs?.connected),
        streaming: Boolean(snap.streaming),
        recording: Boolean(snap.recording),
        replayBuffer: Boolean(snap.replayBuffer),
        scene: snap.currentScene ?? null,
        scenes: snap.scenes?.length ?? 0,
        audio: (snap.audio ?? []).map((a) => ({ name: a.name, muted: a.muted, volumePct: a.volumePct })),
        streamSeconds: snap.streamSeconds ?? 0
      },
      chat: {
        connected: Boolean(chat?.connected),
        channel: chat?.channel ?? settings.chat?.channel ?? '',
        perMinute: messagesLastMinute,
        messages: recent.slice(-4).map((m) => ({ user: m.displayName ?? m.user, text: m.text }))
      },
      overlay: { running: Boolean(overlay?.running), port: overlay?.port ?? null },
      music: {
        playing: Boolean(music?.playing),
        title: music?.state?.().current?.title ?? null,
        volume: settings.music?.volume ?? 75
      },
      ai: {
        model: settings.ai?.model ?? '',
        configured: Boolean(settings.ai?.baseUrl)
      },
      automations: {
        timers,
        counters: (settings.chat?.counters ?? []).length,
        commands: (settings.chat?.commands ?? []).filter((c) => c.enabled !== false).length
      },
      bitrate,
      viewers: null
    }
  }

  broadcast() {
    if (!this.running) return
    try {
      this.#win.webContents.send('notch:state', this.snapshot())
    } catch {
      /* window may be tearing down */
    }
  }
}

module.exports = { Notch, COLLAPSED, EXPANDED }
