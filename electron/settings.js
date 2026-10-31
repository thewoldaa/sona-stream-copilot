'use strict'

const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const DEFAULTS = {
  obs: {
    url: 'ws://127.0.0.1:4455',
    password: '',
    autoConnect: true
  },
  ai: {
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'llama3.1',
    apiKey: '',
    systemPrompt:
      'You are Sona, a calm and competent AI co-pilot for a live streamer. ' +
      'You control OBS Studio through tools. Keep spoken answers to one or two short sentences. ' +
      'Never invent a scene or source name: call list_scenes or get_status first.'
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
    hotkey: 'Control+Alt+Space'
  },
  ui: {
    accent: '#B892FF',
    reduceMotion: false
  }
}

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

function get() {
  if (cached) return cached
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'))
    cached = deepMerge(DEFAULTS, raw)
  } catch {
    cached = structuredClone(DEFAULTS)
  }
  return cached
}

function save(patch) {
  cached = deepMerge(get(), patch ?? {})
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  const tmp = `${file()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(cached, null, 2), 'utf8')
  fs.renameSync(tmp, file())
  return cached
}

module.exports = { get, save, DEFAULTS, file }
