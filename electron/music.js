'use strict'

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')

/**
 * Music queue. The queue is data owned by the main process; playback itself
 * happens in the renderer through a custom media protocol, which allows
 * setSinkId() output routing (so the music can go to a virtual cable that OBS
 * captures) without a native audio dependency.
 */
class MusicService {
  #getSettings
  #saveMusic
  #emit
  playing = false
  index = 0
  #titles = new Map()

  constructor({ getSettings, saveMusic, emit }) {
    this.#getSettings = getSettings
    this.#saveMusic = saveMusic ?? (() => {})
    this.#emit = emit ?? (() => {})
  }

  get cfg() {
    return this.#getSettings().music
  }

  cacheDir() {
    const dir = path.join(app.getPath('userData'), 'music-cache')
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  state() {
    const items = this.cfg.items ?? []
    const current = items[this.index] ?? null
    return {
      playing: this.playing,
      volume: this.cfg.volume ?? 75,
      loop: this.cfg.loop ?? 'off',
      shuffle: Boolean(this.cfg.shuffle),
      index: this.index,
      total: items.length,
      current,
      queue: items.map((i) => ({ id: i.id, title: i.title, source: i.source }))
    }
  }

  #write(items, patch = {}) {
    this.#saveMusic({ items, ...patch })
    if (this.index >= items.length) this.index = Math.max(0, items.length - 1)
    this.#emit('music:state', this.state())
  }

  addLocal(paths = []) {
    const items = [...(this.cfg.items ?? [])]
    let added = 0
    for (const raw of paths) {
      const file = String(raw)
      if (!fs.existsSync(file)) continue
      items.push({
        id: `m${Date.now().toString(36)}${added}`,
        title: path.basename(file),
        path: file,
        source: 'local'
      })
      added++
    }
    if (added) this.#write(items)
    return { ok: added > 0, added, total: items.length }
  }

  async resolve(url) {
    const ytDlp = this.cfg.ytDlpPath
    if (!ytDlp || !fs.existsSync(ytDlp)) {
      return { ok: false, error: 'ytdlp_tidak_ada', hint: 'Set path yt-dlp di Setelan → Musik, atau pilih file lokal.' }
    }
    return new Promise((resolve) => {
      const proc = spawn(ytDlp, ['--no-playlist', '-f', 'bestaudio', '-g', url], { windowsHide: true })
      let out = ''
      let err = ''
      const timer = setTimeout(() => proc.kill(), 45_000)
      proc.stdout.on('data', (d) => (out += d.toString()))
      proc.stderr.on('data', (d) => (err += d.toString()))
      proc.on('close', (code) => {
        clearTimeout(timer)
        const stream = out.split(/\r?\n/).find((line) => /^https?:/.test(line.trim()))
        if (code === 0 && stream) {
          resolve({ ok: true, stream: stream.trim() })
        } else {
          resolve({ ok: false, error: `ytdlp_gagal (${code})`, hint: err.slice(-300) })
        }
      })
    })
  }

  async play(query) {
    const items = [...(this.cfg.items ?? [])]

    if (query) {
      const trimmed = String(query).trim()
      if (/^https?:\/\//i.test(trimmed)) {
        const resolved = await this.resolve(trimmed)
        if (!resolved.ok) return resolved
        items.push({
          id: `m${Date.now().toString(36)}`,
          title: trimmed,
          url: resolved.stream,
          source: 'stream'
        })
        this.#write(items)
        this.index = items.length - 1
      } else if (fs.existsSync(trimmed)) {
        const added = this.addLocal([trimmed])
        if (!added.ok) return { ok: false, error: 'file_tidak_ada' }
        this.index = (this.cfg.items ?? []).length - 1
      } else {
        return { ok: false, error: 'bukan_file_atau_url' }
      }
    }

    const list = this.cfg.items ?? []
    if (!list.length) return { ok: false, error: 'antrean_kosong' }
    if (this.index < 0 || this.index >= list.length) this.index = 0
    const item = list[this.index]
    this.playing = true
    this.#emit('music:play', { item, volume: this.cfg.volume ?? 75, sinkId: this.cfg.sinkId ?? '' })
    this.#emit('music:state', this.state())
    return { ok: true, playing: item.title, index: this.index }
  }

  pause() {
    const next = !this.playing
    this.playing = next
    this.#emit(next ? 'music:resume' : 'music:pause', {})
    this.#emit('music:state', this.state())
    return { ok: true, playing: this.playing }
  }

  setPlaying(value) {
    this.playing = Boolean(value)
    this.#emit('music:state', this.state())
  }

  next() {
    const list = this.cfg.items ?? []
    if (!list.length) return { ok: false, error: 'antrean_kosong' }
    if (this.cfg.shuffle) {
      this.index = Math.floor(Math.random() * list.length)
    } else if (this.cfg.loop === 'one') {
      // stay on the same index
    } else {
      this.index = (this.index + 1) % list.length
    }
    return this.play()
  }

  previous() {
    const list = this.cfg.items ?? []
    if (!list.length) return { ok: false, error: 'antrean_kosong' }
    this.index = (this.index - 1 + list.length) % list.length
    return this.play()
  }

  jump(index) {
    const list = this.cfg.items ?? []
    if (!list.length) return { ok: false, error: 'antrean_kosong' }
    this.index = Math.max(0, Math.min(list.length - 1, Number(index) || 0))
    return this.play()
  }

  setVolume(percent) {
    const volume = Math.max(0, Math.min(100, Number(percent) || 0))
    this.#write(this.cfg.items ?? [], { volume })
    this.#emit('music:volume', { volume })
    return { ok: true, volume }
  }

  setLoop(mode) {
    const loop = ['off', 'all', 'one'].includes(mode) ? mode : 'off'
    this.#write(this.cfg.items ?? [], { loop })
    return { ok: true, loop }
  }

  setShuffle(on) {
    this.#write(this.cfg.items ?? [], { shuffle: Boolean(on) })
    return { ok: true, shuffle: Boolean(on) }
  }

  setSink(sinkId) {
    this.#write(this.cfg.items ?? [], { sinkId: String(sinkId ?? '') })
    this.#emit('music:sink', { sinkId: String(sinkId ?? '') })
    return { ok: true, sinkId: String(sinkId ?? '') }
  }

  clear() {
    this.playing = false
    this.index = 0
    this.#write([])
    this.#emit('music:pause', {})
    return { ok: true }
  }

  remove(id) {
    const items = (this.cfg.items ?? []).filter((i) => i.id !== id)
    this.#write(items)
    return { ok: true, total: items.length }
  }
}

module.exports = { MusicService }
