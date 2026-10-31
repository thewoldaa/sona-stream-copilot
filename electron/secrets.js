'use strict'

const { safeStorage, app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

/**
 * Secrets at rest. Everything sensitive (OBS password, Twitch OAuth token,
 * model API keys) lives in one DPAPI-sealed blob instead of settings.json.
 * On Linux/macOS without a keyring, safeStorage still works via the OS
 * fallback; if it is unavailable we refuse to persist rather than write
 * plaintext to disk.
 */
function file() {
  return path.join(app.getPath('userData'), 'secrets.bin')
}

function available() {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function readAll() {
  if (!available()) return {}
  try {
    const buf = fs.readFileSync(file())
    const json = safeStorage.decryptString(buf)
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeAll(data) {
  if (!available()) return false
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  const buf = safeStorage.encryptString(JSON.stringify(data))
  const tmp = `${file()}.tmp`
  fs.writeFileSync(tmp, buf)
  fs.renameSync(tmp, file())
  return true
}

function get(key) {
  return readAll()[key] ?? ''
}

function set(patch) {
  const next = { ...readAll() }
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === '' || value === null || value === undefined) delete next[key]
    else next[key] = String(value)
  }
  writeAll(next)
  return { ok: true, keys: Object.keys(next) }
}

function clear() {
  try {
    fs.rmSync(file(), { force: true })
  } catch {
    /* nothing to remove */
  }
  return { ok: true }
}

module.exports = { get, set, clear, readAll, available, file }
