'use strict'

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

  constructor(emit) {
    this.#emit = typeof emit === 'function' ? emit : () => {}
    this.status = { connected: false, url: null, obsVersion: null, wsVersion: null, error: null }
    this.snapshot = emptySnapshot()
  }

  async #load() {
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
    const { OBSWebSocket } = await this.#load()
    const client = new OBSWebSocket()
    this.#client = client

    client.on('ConnectionClosed', () => {
      this.#setStatus({ connected: false })
      this.snapshot = emptySnapshot()
      this.#emit('obs:snapshot', this.snapshot)
    })
    client.on('CurrentProgramSceneChanged', () => this.#refreshSoon())
    client.on('SceneListChanged', () => this.#refreshSoon())
    client.on('InputMuteStateChanged', () => this.#refreshSoon())
    client.on('InputVolumeChanged', () => this.#refreshSoon())
    client.on('StreamStateChanged', () => this.#refreshSoon())
    client.on('RecordStateChanged', () => this.#refreshSoon())
    client.on('SceneItemEnableStateChanged', () => this.#refreshSoon())

    try {
      const info = await client.connect(url, password || undefined)
      this.#setStatus({
        connected: true,
        url,
        error: null,
        obsVersion: info?.obsWebSocketVersion ?? null,
        wsVersion: info?.obsWebSocketVersion ?? null
      })
      this.#setStatus({ obsVersion: info?.obsWebSocketVersion ?? null })
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

  #refreshTimer = null
  #refreshSoon() {
    clearTimeout(this.#refreshTimer)
    this.#refreshTimer = setTimeout(() => this.refresh().catch(() => {}), 220)
  }

  async refresh() {
    if (!this.connected) return this.snapshot
    const [version, sceneList, stream, record, vcam] = await Promise.all([
      this.call('GetVersion'),
      this.call('GetSceneList'),
      this.call('GetStreamStatus'),
      this.call('GetRecordStatus'),
      this.call('GetVirtualCamStatus')
    ])

    const scenes = Array.isArray(sceneList.data?.scenes)
      ? sceneList.data.scenes.map((s) => s.sceneName).reverse()
      : []
    const current = sceneList.data?.currentProgramSceneName ?? sceneList.data?.currentScene ?? null

    const inputs = await this.call('GetInputList')
    const audio = []
    for (const item of inputs.data?.inputs ?? []) {
      if (!/audio|wasapi|pulse|alsa|coreaudio/i.test(item.inputKind ?? '')) continue
      const [vol, mute] = await Promise.all([
        this.call('GetInputVolume', { inputName: item.inputName }),
        this.call('GetInputMute', { inputName: item.inputName })
      ])
      audio.push({
        name: item.inputName,
        volumeDb: vol.data?.inputVolumeDb ?? 0,
        volumePct: dbToPercent(vol.data?.inputVolumeDb ?? -100),
        muted: Boolean(mute.data?.inputMuted)
      })
    }

    this.snapshot = {
      obsVersion: version.data?.obsVersion ?? null,
      wsVersion: version.data?.obsWebSocketVersion ?? null,
      scenes,
      currentScene: current,
      audio,
      streaming: Boolean(stream.data?.outputActive),
      recording: Boolean(record.data?.outputActive),
      virtualCam: Boolean(vcam.data?.outputActive),
      updatedAt: Date.now()
    }
    this.#emit('obs:snapshot', this.snapshot)
    return this.snapshot
  }

  statusInfo() {
    return { ...this.status }
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
    audio: [],
    streaming: false,
    recording: false,
    virtualCam: false,
    updatedAt: null
  }
}

module.exports = { ObsManager, dbToPercent, percentToDb, emptySnapshot }
