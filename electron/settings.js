'use strict'

const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const secrets = require('./secrets')

const DEFAULTS = {
  obs: {
    url: 'ws://127.0.0.1:4455',
    password: '',
    autoConnect: true,
    autoDetect: true
  },
  ai: {
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'llama3.1',
    apiKey: '',
    temperature: 0.4,
    systemPrompt:
      'You are Sona, a calm and competent AI co-pilot for a live streamer. ' +
      'You control OBS Studio through tools and you moderate a Twitch chat. ' +
      'Keep spoken answers to one or two short sentences. ' +
      'Never invent a scene, source, or command name: read state first with get_status, list_scenes, or list_sources.'
  },
  stt: {
    enabled: false,
    baseUrl: 'http://127.0.0.1:8000/v1',
    model: 'whisper-1',
    apiKey: '',
    language: 'id'
  },
  voice: {
    ttsEnabled: true,
    rate: 1.05,
    pitch: 1,
    voiceName: '',
    hotkey: 'Control+Alt+Space',
    readAloud: false
  },
  wake: {
    enabled: false,
    phrase: 'sona',
    threshold: 0.055,
    silenceMs: 850,
    maxUtteranceMs: 9000
  },
  chat: {
    enabled: false,
    channel: '',
    username: '',
    hasToken: false,
    connected: false,
    readAloudSkipLinks: true,
    readAloudSkipBots: true,
    readAloudMinLength: 3,
    sendCooldownMs: 1200,
    moderation: {
      enabled: true,
      blacklist: ['kata-kasar-contoh'],
      maxCapsPercent: 75,
      minCapsLength: 12,
      allowLinks: false,
      maxEmotes: 8,
      maxSymbolsPercent: 40,
      action: 'delete',
      timeoutSeconds: 60,
      aiAssist: false,
      aiModelHint: 'flag only obvious harassment or spam; answer with HOLD or DELETE'
    },
    commands: [
      { name: 'discord', reply: 'Komunitas: ganti link ini di Setelan → Chat → Commands', cooldownSec: 30, enabled: true },
      { name: 'socials', reply: 'Semua tautan ada di panel deskripsi.', cooldownSec: 30, enabled: true }
    ],
    counters: [{ name: 'deaths', value: 0 }],
    timers: [
      { id: 't1', text: 'Sona jalan 100% lokal — tanpa langganan.', intervalMin: 15, enabled: false }
    ],
    poll: null,
    giveaway: null
  },
  overlay: {
    enabled: true,
    port: 8787,
    width: 1920,
    height: 1080,
    elements: [
      {
        id: 'el-title',
        type: 'text',
        x: 80,
        y: 70,
        width: 900,
        text: 'LIVE — {{scene}}',
        fontSize: 44,
        weight: 700,
        color: '#ECEAF4',
        align: 'left',
        visible: true
      },
      {
        id: 'el-chat',
        type: 'chat',
        x: 80,
        y: 820,
        width: 620,
        lines: 5,
        fontSize: 22,
        color: '#ECEAF4',
        accent: '#B892FF',
        visible: true
      },
      {
        id: 'el-alert',
        type: 'alert',
        x: 560,
        y: 300,
        width: 800,
        text: '{{user}} baru saja follow!',
        fontSize: 40,
        color: '#B892FF',
        visible: true
      }
    ],
    alerts: { follow: true, sub: true, raid: true, cheer: true }
  },
  music: {
    items: [],
    volume: 75,
    loop: 'off',
    shuffle: false,
    sinkId: '',
    ytDlpPath: ''
  },
  ui: {
    accent: '#B892FF',
    reduceMotion: false
  },
  onboarding: {
    done: false,
    step: 0
  },
  orb: {
    enabled: true,
    visible: true,
    corner: 'br',
    size: 132,
    x: null,
    y: null,
    popups: true
  }
}

const SECRET_KEYS = ['obsPassword', 'twitchToken', 'aiKey', 'sttKey']

let cached = null

function file() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch ?? base
  const out = Array.isArray(base) ? [...base] : { ...base }
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(base?.[k] ?? {}, v) : v
  }
  return out
}

/**
 * Settings used to carry secrets in plaintext. Move them into the sealed blob
 * the first time this build runs, then blank the disk fields.
 */
function migrateSecrets(settings) {
  const moves = []
  if (settings.obs?.password) moves.push(['obsPassword', settings.obs.password, () => (settings.obs.password = '')])
  if (settings.ai?.apiKey) moves.push(['aiKey', settings.ai.apiKey, () => (settings.ai.apiKey = '')])
  if (settings.stt?.apiKey) moves.push(['sttKey', settings.stt.apiKey, () => (settings.stt.apiKey = '')])
  if (!moves.length) return false

  if (!secrets.available()) {
    // No keychain: keep the values where they are rather than destroying them.
    return false
  }
  const patch = {}
  for (const [key, value, clear] of moves) {
    patch[key] = value
    clear()
  }
  secrets.set(patch)
  if (secrets.get('twitchToken')) settings.chat.hasToken = true
  return true
}

function get() {
  if (cached) return cached
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'))
    cached = deepMerge(DEFAULTS, raw)
  } catch {
    cached = structuredClone(DEFAULTS)
  }
  if (migrateSecrets(cached)) {
    try {
      persist(cached)
    } catch {
      /* migration is best effort */
    }
  }
  return cached
}

function persist(next) {
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  const tmp = `${file()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
  fs.renameSync(tmp, file())
}

function save(patch) {
  cached = deepMerge(get(), patch ?? {})
  // Never let secrets reach the settings file, whatever the renderer sends.
  cached.obs.password = ''
  cached.ai.apiKey = ''
  cached.stt.apiKey = ''
  persist(cached)
  return cached
}

/** Apply secret fields the renderer submitted alongside a settings save. */
function saveSecrets(source) {
  const patch = {}
  if (typeof source?.obsPassword === 'string' && source.obsPassword) patch.obsPassword = source.obsPassword
  if (typeof source?.twitchToken === 'string' && source.twitchToken) patch.twitchToken = source.twitchToken
  if (typeof source?.aiKey === 'string' && source.aiKey) patch.aiKey = source.aiKey
  if (typeof source?.sttKey === 'string' && source.sttKey) patch.sttKey = source.sttKey
  if (!Object.keys(patch).length) return { ok: true, changed: [] }
  const res = secrets.set(patch)
  if (patch.twitchToken) {
    cached = { ...get(), chat: { ...get().chat, hasToken: true } }
    persist(cached)
  }
  return { ok: res.ok, changed: Object.keys(patch) }
}

function secretStatus() {
  return {
    available: secrets.available(),
    obsPassword: Boolean(secrets.get('obsPassword')),
    twitchToken: Boolean(secrets.get('twitchToken')),
    aiKey: Boolean(secrets.get('aiKey')),
    sttKey: Boolean(secrets.get('sttKey'))
  }
}

module.exports = { get, save, saveSecrets, secretStatus, DEFAULTS, file, SECRET_KEYS }
