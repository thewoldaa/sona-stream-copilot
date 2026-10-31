'use strict'

const fs = require('node:fs')
const path = require('node:path')

const MAX_UNDO = 30
const MAX_RESTORE_POINTS = 10

/**
 * Thin, defensive wrapper around obs-websocket-js v5.
 * Every call is serialised through a single queue: OBS answers in order and a
 * burst of parallel writes (which an LLM loves to emit) answers out of order.
 */
class ObsManager {
  #queue = Promise.resolve()
  #client = null
  #lib = null
  #emit
  #undo = []
  #refreshTimer = null

  constructor(emit) {
    this.#emit = typeof emit === 'function' ? emit : () => {}
    this.status = { connected: false, url: null, obsVersion: null, wsVersion: null, error: null }
    this.snapshot = emptySnapshot()
  }

  #load() {
    // obs-websocket-js ships a CJS build; requiring avoids ESM-in-asar edge cases.
    if (!this.#lib) this.#lib = require('obs-websocket-js')
    return this.#lib
  }

  #setStatus(patch) {
    this.status = { ...this.status, ...patch }
    this.#emit('obs:status', this.status)
  }

  async connect({ url, password }) {
    await this.disconnect()
    const { OBSWebSocket } = this.#load()
    const client = new OBSWebSocket()
    this.#client = client

    client.on('ConnectionClosed', () => {
      this.#setStatus({ connected: false })
      this.snapshot = emptySnapshot()
      this.#emit('obs:snapshot', this.snapshot)
    })

    for (const event of [
      'CurrentProgramSceneChanged',
      'CurrentPreviewSceneChanged',
      'SceneListChanged',
      'InputMuteStateChanged',
      'InputVolumeChanged',
      'StreamStateChanged',
      'RecordStateChanged',
      'SceneItemEnableStateChanged',
      'SceneItemTransformChanged',
      'SceneItemListChanged',
      'StudioModeStateChanged',
      'CurrentSceneTransitionChanged',
      'VirtualCamStateChanged',
      'ReplayBufferStateChanged'
    ]) {
      client.on(event, () => this.refreshSoon())
    }

    try {
      const info = await client.connect(url, password || undefined)
      this.#setStatus({
        connected: true,
        url,
        error: null,
        wsVersion: info?.obsWebSocketVersion ?? null
      })
      await this.refresh()
      return { ok: true, status: this.status }
    } catch (err) {
      this.#client = null
      this.#setStatus({ connected: false, url, error: String(err?.message ?? err) })
      return { ok: false, error: String(err?.message ?? err) }
    }
  }

  async disconnect() {
    const client = this.#client
    this.#client = null
    if (client) {
      try {
        await client.disconnect()
      } catch {
        /* already gone */
      }
    }
    this.#setStatus({ connected: false })
    this.snapshot = emptySnapshot()
    this.#emit('obs:snapshot', this.snapshot)
    return { ok: true }
  }

  get connected() {
    return Boolean(this.#client && this.status.connected)
  }

  /** Serialised raw call. Returns { ok, data } and never throws. */
  call(requestType, requestData = {}) {
    const run = async () => {
      if (!this.#client) return { ok: false, error: 'OBS_NOT_CONNECTED' }
      try {
        const data = await this.#client.call(requestType, requestData)
        return { ok: true, data }
      } catch (err) {
        return { ok: false, error: String(err?.message ?? err), code: err?.code ?? null }
      }
    }
    const next = this.#queue.then(run, run)
    this.#queue = next.then(() => {}, () => {})
    return next
  }

  refreshSoon() {
    clearTimeout(this.#refreshTimer)
    this.#refreshTimer = setTimeout(() => this.refresh().catch(() => {}), 220)
  }

  async refresh() {
    if (!this.connected) return this.snapshot
    const [version, sceneList, stream, record, vcam, replay, studio, transition, profile, collection, preview] =
      await Promise.all([
        this.call('GetVersion'),
        this.call('GetSceneList'),
        this.call('GetStreamStatus'),
        this.call('GetRecordStatus'),
        this.call('GetVirtualCamStatus'),
        this.call('GetReplayBufferStatus'),
        this.call('GetStudioModeEnabled'),
        this.call('GetCurrentSceneTransition'),
        this.call('GetProfileList'),
        this.call('GetSceneCollectionList'),
        this.call('GetCurrentPreviewScene')
      ])

    const scenes = Array.isArray(sceneList.data?.scenes)
      ? sceneList.data.scenes.map((s) => s.sceneName).reverse()
      : []
    const current = sceneList.data?.currentProgramSceneName ?? null

    const inputs = await this.call('GetInputList')
    const audio = []
    const probe = (inputs.data?.inputs ?? []).map(async (item) => {
      const mute = await this.call('GetInputMute', { inputName: item.inputName })
      if (!mute.ok) return null // not an audio-capable input
      const [vol, tracks] = await Promise.all([
        this.call('GetInputVolume', { inputName: item.inputName }),
        this.call('GetInputAudioTracks', { inputName: item.inputName })
      ])
      return {
        name: item.inputName,
        kind: item.inputKind ?? '',
        volumeDb: vol.data?.inputVolumeDb ?? 0,
        volumePct: dbToPercent(vol.data?.inputVolumeDb ?? -100),
        muted: Boolean(mute.data?.inputMuted),
        tracks: tracks.data?.inputAudioTracks ?? null
      }
    })
    for (const entry of await Promise.all(probe)) {
      if (entry) audio.push(entry)
    }

    this.snapshot = {
      obsVersion: version.data?.obsVersion ?? null,
      wsVersion: version.data?.obsWebSocketVersion ?? null,
      scenes,
      currentScene: current,
      previewScene: preview.ok ? preview.data?.currentPreviewSceneName ?? null : null,
      studioMode: Boolean(studio.data?.studioModeEnabled),
      transition: transition.ok
        ? {
            name: transition.data?.transitionName ?? null,
            kind: transition.data?.transitionKind ?? null,
            duration: transition.data?.transitionDuration ?? null
          }
        : null,
      profile: profile.ok ? profile.data?.currentProfileName ?? null : null,
      sceneCollection: collection.ok ? collection.data?.currentSceneCollectionName ?? null : null,
      audio,
      streaming: Boolean(stream.data?.outputActive),
      streamSeconds: Math.floor((Number(stream.data?.outputDuration) || 0) / 1000),
      recording: Boolean(record.data?.outputActive),
      recordingPaused: Boolean(record.data?.outputPaused),
      replayBuffer: Boolean(replay.data?.outputActive),
      virtualCam: Boolean(vcam.data?.outputActive),
      updatedAt: Date.now()
    }
    this.#emit('obs:snapshot', this.snapshot)
    return this.snapshot
  }

  statusInfo() {
    return { ...this.status, undoDepth: this.#undo.length }
  }

  /* -------------------------------- undo -------------------------------- */

  /** Register an inverse action. `apply` receives the manager and must not throw. */
  pushUndo(label, apply) {
    if (typeof apply !== 'function') return
    this.#undo.push({ label, apply, at: Date.now() })
    if (this.#undo.length > MAX_UNDO) this.#undo.shift()
  }

  undoDepth() {
    return this.#undo.length
  }

  peekUndo() {
    return this.#undo.at(-1)?.label ?? null
  }

  async undo() {
    const entry = this.#undo.pop()
    if (!entry) return { ok: false, error: 'nothing_to_undo' }
    try {
      await entry.apply(this)
      await this.refresh()
      return { ok: true, undone: entry.label }
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err), undone: entry.label }
    }
  }

  /* ---------------------------- restore points --------------------------- */

  #restoreFile() {
    return path.join(require('electron').app.getPath('userData'), 'restore-points.json')
  }

  #readRestorePoints() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.#restoreFile(), 'utf8'))
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  #writeRestorePoints(list) {
    const file = this.#restoreFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(list.slice(-MAX_RESTORE_POINTS), null, 2), 'utf8')
    fs.renameSync(tmp, file)
  }

  listRestorePoints() {
    return this.#readRestorePoints().map((p) => ({ name: p.name, at: p.at, scenes: p.scenes.length }))
  }

  /** Capture the *switchable* state: scene item layout/visibility/lock + audio mix. */
  async saveRestorePoint(name) {
    if (!this.connected) return { ok: false, error: 'OBS_NOT_CONNECTED' }
    const { scenes } = this.snapshot
    const out = { name: name || `point-${new Date().toISOString().slice(0, 19)}`, at: Date.now(), scenes: [], audio: [] }

    for (const scene of scenes) {
      const items = await this.call('GetSceneItemList', { sceneName: scene })
      if (!items.ok) continue
      const rows = []
      for (const item of items.data?.sceneItems ?? []) {
        const transform = await this.call('GetSceneItemTransform', {
          sceneName: scene,
          sceneItemId: item.sceneItemId
        })
        rows.push({
          source: item.sourceName,
          enabled: Boolean(item.sceneItemEnabled),
          locked: Boolean(item.sceneItemLocked),
          transform: transform.ok ? transform.data?.sceneItemTransform ?? null : null
        })
      }
      out.scenes.push({ name: scene, items: rows })
    }

    for (const input of this.snapshot.audio) {
      const monitor = await this.call('GetInputAudioMonitorType', { inputName: input.name })
      out.audio.push({
        name: input.name,
        volumeDb: input.volumeDb,
        muted: input.muted,
        monitorType: monitor.ok ? monitor.data?.monitorType ?? null : null
      })
    }

    const list = this.#readRestorePoints().filter((p) => p.name !== out.name)
    list.push(out)
    this.#writeRestorePoints(list)
    return { ok: true, name: out.name, at: out.at, scenes: out.scenes.length, audio: out.audio.length }
  }

  async restorePoint(name) {
    if (!this.connected) return { ok: false, error: 'OBS_NOT_CONNECTED' }
    const point = this.#readRestorePoints().find((p) => p.name === name)
    if (!point) return { ok: false, error: `unknown_restore_point: ${name}`, available: this.listRestorePoints().map((p) => p.name) }

    let applied = 0
    for (const scene of point.scenes) {
      const items = await this.call('GetSceneItemList', { sceneName: scene.name })
      if (!items.ok) continue
      const byName = new Map((items.data?.sceneItems ?? []).map((i) => [i.sourceName, i]))
      for (const saved of scene.items) {
        const live = byName.get(saved.source)
        if (!live) continue
        if (live.sceneItemEnabled !== saved.enabled) {
          await this.call('SetSceneItemEnabled', {
            sceneName: scene.name,
            sceneItemId: live.sceneItemId,
            sceneItemEnabled: saved.enabled
          })
          applied++
        }
        if (Boolean(live.sceneItemLocked) !== Boolean(saved.locked)) {
          await this.call('SetSceneItemLocked', {
            sceneName: scene.name,
            sceneItemId: live.sceneItemId,
            sceneItemLocked: saved.locked
          })
          applied++
        }
        if (saved.transform) {
          await this.call('SetSceneItemTransform', {
            sceneName: scene.name,
            sceneItemId: live.sceneItemId,
            sceneItemTransform: saved.transform
          })
          applied++
        }
      }
    }

    for (const input of point.audio) {
      await this.call('SetInputVolume', { inputName: input.name, inputVolumeDb: input.volumeDb })
      await this.call('SetInputMute', { inputName: input.name, inputMuted: input.muted })
      if (input.monitorType) {
        await this.call('SetInputAudioMonitorType', { inputName: input.name, monitorType: input.monitorType })
      }
      applied++
    }

    await this.refresh()
    return { ok: true, name, applied }
  }
}

function dbToPercent(db) {
  const clamped = Math.max(-100, Math.min(0, Number(db) || -100))
  return Math.round(((clamped + 100) / 100) * 100)
}

function percentToDb(pct) {
  const clamped = Math.max(0, Math.min(100, Number(pct) || 0))
  return clamped === 0 ? -100 : (clamped / 100) * 100 - 100
}

function emptySnapshot() {
  return {
    obsVersion: null,
    wsVersion: null,
    scenes: [],
    currentScene: null,
    previewScene: null,
    studioMode: false,
    transition: null,
    profile: null,
    sceneCollection: null,
    audio: [],
    streaming: false,
    recording: false,
    recordingPaused: false,
    replayBuffer: false,
    virtualCam: false,
    updatedAt: null
  }
}

/**
 * Request types the renderer may issue directly from the UI. The agent has a
 * wider reach through tools.js; this list is what a compromised renderer gets.
 */
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
  'GetReplayBufferStatus',
  'StartReplayBuffer',
  'StopReplayBuffer',
  'TriggerStudioModeTransition',
  'SetCurrentSceneTransition',
  'GetCurrentSceneTransition',
  'SetMediaInputCursor',
  'TriggerMediaInputAction',
  'GetVersion',
  'GetInputAudioTracks',
  'SetInputAudioTracks',
  'GetSceneItemTransform',
  'SetSceneItemTransform',
  'GetInputAudioMonitorType',
  'SetInputAudioMonitorType',
  'SaveSourceScreenshot'
])

module.exports = {
  ObsManager,
  dbToPercent,
  percentToDb,
  emptySnapshot,
  RENDERER_OBS_ALLOWED
}
