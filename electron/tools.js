'use strict'

/**
 * The tool surface. One entry per capability, mapped onto OBS requests or a
 * local subsystem (chat, overlay, music). The model never touches OBS directly:
 * it can only name a tool that exists here.
 */

const tools = []

const { percentToDb, dbToPercent } = require('./obs')

function tool(name, description, properties = {}, required = [], run) {
  tools.push({
    schema: {
      type: 'function',
      function: {
        name,
        description,
        parameters: { type: 'object', properties, required, additionalProperties: false }
      }
    },
    run
  })
}

const S = (description) => ({ type: 'string', description })
const N = (description) => ({ type: 'number', description })
const B = (description) => ({ type: 'boolean', description })

const ok = (data) => ({ ok: true, data: data ?? null })
const fail = (error, extra) => ({ ok: false, error, ...(extra ? { detail: extra } : {}) })

/* --------------------------------- helpers -------------------------------- */

function pickScene(obs, raw) {
  const scenes = obs.snapshot.scenes
  if (!raw) return obs.snapshot.currentScene
  if (scenes.includes(raw)) return raw
  const low = String(raw).toLowerCase()
  return scenes.find((s) => s.toLowerCase() === low) ?? scenes.find((s) => s.toLowerCase().includes(low)) ?? null
}

function pickAudio(obs, raw) {
  const list = obs.snapshot.audio
  if (!raw) return null
  const low = String(raw).toLowerCase()
  return (
    list.find((a) => a.name === raw) ??
    list.find((a) => a.name.toLowerCase() === low) ??
    list.find((a) => a.name.toLowerCase().includes(low)) ??
    null
  )
}

async function sceneItemId(obs, sceneName, sourceName) {
  const res = await obs.call('GetSceneItemId', { sceneName, sourceName })
  return res.ok ? res.data.sceneItemId : null
}

function requireOBS(obs) {
  return obs.connected ? null : fail('OBS_NOT_CONNECTED', { hint: 'Sambungkan OBS dulu di tab OBS.' })
}

/* ------------------------------ status & read ----------------------------- */

tool('get_status', 'Read the whole current state: scenes, program/preview scene, transition, studio mode, audio inputs, stream/record/replay/vcam flags.', {}, [], async ({ obs }) => {
  if (!obs.connected) return fail('OBS_NOT_CONNECTED')
  return ok(await obs.refresh())
})

tool('list_scenes', 'List every scene name in the current scene collection.', {}, [], async ({ obs }) =>
  ok({ scenes: obs.snapshot.scenes, current: obs.snapshot.currentScene, preview: obs.snapshot.previewScene })
)

tool(
  'list_sources',
  'List the sources inside a scene, with their id, visibility, lock state and position.',
  { scene_name: S('Scene name. Defaults to the program scene.') },
  [],
  async ({ obs, args }) => {
    const scene = pickScene(obs, args.scene_name)
    if (!scene) return fail(`unknown_scene: ${args.scene_name ?? '(none)'}`, { scenes: obs.snapshot.scenes })
    const res = await obs.call('GetSceneItemList', { sceneName: scene })
    if (!res.ok) return fail(res.error)
    return ok({
      scene,
      items: (res.data?.sceneItems ?? []).map((i) => ({
        id: i.sceneItemId,
        source: i.sourceName,
        enabled: Boolean(i.sceneItemEnabled),
        locked: Boolean(i.sceneItemLocked),
        x: i.sceneItemTransform?.positionX ?? null,
        y: i.sceneItemTransform?.positionY ?? null,
        scaleX: i.sceneItemTransform?.scaleX ?? null,
        scaleY: i.sceneItemTransform?.scaleY ?? null
      }))
    })
  }
)

tool(
  'list_filters',
  'List the filters attached to a source and whether each is enabled.',
  { source_name: S('Source name.') },
  ['source_name'],
  async ({ obs, args }) => {
    const res = await obs.call('GetSourceFilterList', { sourceName: args.source_name })
    if (!res.ok) return fail(res.error)
    return ok({ source: args.source_name, filters: res.data?.filters ?? [] })
  }
)

tool('get_stats', 'Read OBS performance stats: CPU, memory, FPS, render lag, dropped frames.', {}, [], async ({ obs }) => {
  if (!obs.connected) return fail('OBS_NOT_CONNECTED')
  const res = await obs.call('GetStats')
  return res.ok ? ok(res.data) : fail(res.error)
})

/* --------------------------------- scenes --------------------------------- */

tool(
  'switch_scene',
  'Switch the live (program) scene.',
  { scene_name: S('Exact scene name.') },
  ['scene_name'],
  async ({ obs, args }) => {
    const guard = requireOBS(obs)
    if (guard) return guard
    const scene = pickScene(obs, args.scene_name)
    if (!scene) return fail(`unknown_scene: ${args.scene_name}`, { scenes: obs.snapshot.scenes })
    const previous = obs.snapshot.currentScene
    const res = await obs.call('SetCurrentProgramScene', { sceneName: scene })
    if (!res.ok) return fail(res.error)
    if (previous && previous !== scene) {
      obs.pushUndo(`scene:${previous}`, async (o) => {
        await o.call('SetCurrentProgramScene', { sceneName: previous })
      })
    }
    obs.refreshSoon()
    return ok({ switchedTo: scene, previous })
  }
)

tool(
  'set_preview_scene',
  'Set the preview scene while studio mode is on.',
  { scene_name: S('Exact scene name.') },
  ['scene_name'],
  async ({ obs, args }) => {
    const scene = pickScene(obs, args.scene_name)
    if (!scene) return fail(`unknown_scene: ${args.scene_name}`)
    const res = await obs.call('SetCurrentPreviewScene', { sceneName: scene })
    if (!res.ok) return fail(res.error)
    obs.refreshSoon()
    return ok({ preview: scene })
  }
)

tool(
  'trigger_transition',
  'Run the scene transition. Optionally set the transition first (e.g. "Fade", "Cut", "Stinger").',
  { transition_name: S('Transition name from the OBS transition list.'), duration_ms: N('Optional duration override in milliseconds.') },
  [],
  async ({ obs, args }) => {
    if (args.transition_name) {
      const set = await obs.call('SetCurrentSceneTransition', { transitionName: args.transition_name })
      if (!set.ok) return fail(set.error)
    }
    if (args.duration_ms != null) {
      await obs.call('SetCurrentSceneTransitionDuration', { transitionDuration: Number(args.duration_ms) })
    }
    const res = await obs.call('TriggerStudioModeTransition')
    obs.refreshSoon()
    return res.ok ? ok({ transitioned: true, name: args.transition_name ?? obs.snapshot.transition?.name ?? null }) : fail(res.error)
  }
)

tool('set_studio_mode', 'Turn studio mode (preview/program) on or off.', { enabled: B('true to enable') }, ['enabled'], async ({ obs, args }) => {
  const res = await obs.call('SetStudioModeEnabled', { studioModeEnabled: Boolean(args.enabled) })
  obs.refreshSoon()
  return res.ok ? ok({ studioMode: Boolean(args.enabled) }) : fail(res.error)
})

tool('create_scene', 'Create a new empty scene.', { scene_name: S('Name for the new scene.') }, ['scene_name'], async ({ obs, args }) => {
  const res = await obs.call('CreateScene', { sceneName: args.scene_name })
  if (!res.ok) return fail(res.error)
  obs.pushUndo(`scene-created:${args.scene_name}`, async (o) => {
    await o.call('RemoveScene', { sceneName: args.scene_name })
  })
  await obs.refresh()
  return ok({ created: args.scene_name })
})

tool('delete_scene', 'Delete a scene. Cannot be undone through Sona — save a restore point first if unsure.', { scene_name: S('Scene to delete.') }, ['scene_name'], async ({ obs, args }) => {
  const scene = pickScene(obs, args.scene_name)
  if (!scene) return fail(`unknown_scene: ${args.scene_name}`)
  const res = await obs.call('RemoveScene', { sceneName: scene })
  await obs.refresh()
  return res.ok ? ok({ deleted: scene }) : fail(res.error)
})

tool(
  'rename_scene',
  'Rename an existing scene.',
  { scene_name: S('Current name.'), new_name: S('New name.') },
  ['scene_name', 'new_name'],
  async ({ obs, args }) => {
    const scene = pickScene(obs, args.scene_name)
    if (!scene) return fail(`unknown_scene: ${args.scene_name}`)
    const res = await obs.call('SetSceneName', { sceneName: scene, newSceneName: args.new_name })
    await obs.refresh()
    return res.ok ? ok({ renamed: scene, to: args.new_name }) : fail(res.error)
  }
)

/* -------------------------------- sources --------------------------------- */

tool(
  'set_source_visible',
  'Show or hide a source inside a scene.',
  { scene_name: S('Scene name.'), source_name: S('Source name.'), visible: B('true to show') },
  ['scene_name', 'source_name', 'visible'],
  async ({ obs, args }) => {
    const scene = pickScene(obs, args.scene_name)
    if (!scene) return fail(`unknown_scene: ${args.scene_name}`)
    const id = await sceneItemId(obs, scene, args.source_name)
    if (id == null) return fail(`unknown_source: ${args.source_name}`)
    const before = await obs.call('GetSceneItemEnabled', { sceneName: scene, sceneItemId: id })
    const res = await obs.call('SetSceneItemEnabled', { sceneName: scene, sceneItemId: id, sceneItemEnabled: Boolean(args.visible) })
    if (!res.ok) return fail(res.error)
    if (before.ok) {
      obs.pushUndo(`visibility:${args.source_name}`, async (o) => {
        await o.call('SetSceneItemEnabled', {
          sceneName: scene,
          sceneItemId: id,
          sceneItemEnabled: Boolean(before.data?.sceneItemEnabled)
        })
      })
    }
    obs.refreshSoon()
    return ok({ scene, source: args.source_name, visible: Boolean(args.visible) })
  }
)

tool(
  'toggle_source_visibility',
  'Flip a source between visible and hidden.',
  { scene_name: S('Scene name.'), source_name: S('Source name.') },
  ['scene_name', 'source_name'],
  async ({ obs, args }) => {
    const scene = pickScene(obs, args.scene_name)
    if (!scene) return fail(`unknown_scene: ${args.scene_name}`)
    const id = await sceneItemId(obs, scene, args.source_name)
    if (id == null) return fail(`unknown_source: ${args.source_name}`)
    const before = await obs.call('GetSceneItemEnabled', { sceneName: scene, sceneItemId: id })
    if (!before.ok) return fail(before.error)
    const next = !before.data.sceneItemEnabled
    await obs.call('SetSceneItemEnabled', { sceneName: scene, sceneItemId: id, sceneItemEnabled: next })
    obs.pushUndo(`visibility:${args.source_name}`, async (o) => {
      await o.call('SetSceneItemEnabled', { sceneName: scene, sceneItemId: id, sceneItemEnabled: !next })
    })
    obs.refreshSoon()
    return ok({ scene, source: args.source_name, visible: next })
  }
)

tool(
  'set_source_transform',
  'Move, scale, rotate or crop a source. Only the fields you pass are changed.',
  {
    scene_name: S('Scene name.'),
    source_name: S('Source name.'),
    x: N('Absolute X in canvas pixels.'),
    y: N('Absolute Y in canvas pixels.'),
    scale: N('Uniform scale, 1 = 100%.'),
    rotation: N('Rotation in degrees.'),
    crop_left: N('Crop pixels from the left.'),
    crop_right: N('Crop pixels from the right.'),
    crop_top: N('Crop pixels from the top.'),
    crop_bottom: N('Crop pixels from the bottom.')
  },
  ['scene_name', 'source_name'],
  async ({ obs, args }) => {
    const scene = pickScene(obs, args.scene_name)
    if (!scene) return fail(`unknown_scene: ${args.scene_name}`)
    const id = await sceneItemId(obs, scene, args.source_name)
    if (id == null) return fail(`unknown_source: ${args.source_name}`)

    const before = await obs.call('GetSceneItemTransform', { sceneName: scene, sceneItemId: id })
    const current = before.data?.sceneItemTransform ?? {}
    const patch = {}
    if (args.x != null) patch.positionX = Number(args.x)
    if (args.y != null) patch.positionY = Number(args.y)
    if (args.scale != null) {
      patch.scaleX = Number(args.scale)
      patch.scaleY = Number(args.scale)
    }
    if (args.rotation != null) patch.rotation = Number(args.rotation)
    if (args.crop_left != null) patch.cropLeft = Number(args.crop_left)
    if (args.crop_right != null) patch.cropRight = Number(args.crop_right)
    if (args.crop_top != null) patch.cropTop = Number(args.crop_top)
    if (args.crop_bottom != null) patch.cropBottom = Number(args.crop_bottom)
    if (!Object.keys(patch).length) return fail('no_transform_fields')

    const res = await obs.call('SetSceneItemTransform', {
      sceneName: scene,
      sceneItemId: id,
      sceneItemTransform: { ...current, ...patch }
    })
    if (!res.ok) return fail(res.error)
    obs.pushUndo(`transform:${args.source_name}`, async (o) => {
      await o.call('SetSceneItemTransform', { sceneName: scene, sceneItemId: id, sceneItemTransform: current })
    })
    obs.refreshSoon()
    return ok({ scene, source: args.source_name, applied: Object.keys(patch) })
  }
)

tool(
  'set_source_locked',
  'Lock or unlock a source in the OBS canvas so it cannot be dragged by accident.',
  { scene_name: S('Scene name.'), source_name: S('Source name.'), locked: B('true to lock') },
  ['scene_name', 'source_name', 'locked'],
  async ({ obs, args }) => {
    const scene = pickScene(obs, args.scene_name)
    if (!scene) return fail(`unknown_scene: ${args.scene_name}`)
    const id = await sceneItemId(obs, scene, args.source_name)
    if (id == null) return fail(`unknown_source: ${args.source_name}`)
    const res = await obs.call('SetSceneItemLocked', { sceneName: scene, sceneItemId: id, sceneItemLocked: Boolean(args.locked) })
    obs.refreshSoon()
    return res.ok ? ok({ source: args.source_name, locked: Boolean(args.locked) }) : fail(res.error)
  }
)

tool(
  'set_source_order',
  'Reorder a source inside its scene. Index 0 is the bottom of the list.',
  { scene_name: S('Scene name.'), source_name: S('Source name.'), index: N('Target index.') },
  ['scene_name', 'source_name', 'index'],
  async ({ obs, args }) => {
    const scene = pickScene(obs, args.scene_name)
    if (!scene) return fail(`unknown_scene: ${args.scene_name}`)
    const id = await sceneItemId(obs, scene, args.source_name)
    if (id == null) return fail(`unknown_source: ${args.source_name}`)
    const res = await obs.call('SetSceneItemIndex', { sceneName: scene, sceneItemId: id, sceneItemIndex: Number(args.index) })
    obs.refreshSoon()
    return res.ok ? ok({ source: args.source_name, index: Number(args.index) }) : fail(res.error)
  }
)

const SOURCE_KINDS = [
  'browser_source',
  'image_source',
  'color_source_v3',
  'text_gdiplus_v3',
  'media_source',
  'vlc_source',
  'ffmpeg_source',
  'wasapi_output_capture',
  'wasapi_input_capture',
  'monitor_capture',
  'window_capture',
  'game_capture',
  'dshow_input'
]

tool(
  'add_source',
  'Add a new source to a scene.',
  {
    scene_name: S('Scene to add the source to.'),
    source_name: S('Name for the new source.'),
    kind: { type: 'string', enum: SOURCE_KINDS, description: 'OBS input kind.' },
    settings: { type: 'object', description: 'Optional settings, e.g. {"url":"https://..."} for a browser source.' }
  },
  ['scene_name', 'source_name', 'kind'],
  async ({ obs, args }) => {
    const scene = pickScene(obs, args.scene_name)
    if (!scene) return fail(`unknown_scene: ${args.scene_name}`)
    const res = await obs.call('CreateInput', {
      sceneName: scene,
      inputName: args.source_name,
      inputKind: args.kind,
      inputSettings: args.settings ?? {},
      sceneItemEnabled: true
    })
    if (!res.ok) return fail(res.error)
    obs.pushUndo(`source-added:${args.source_name}`, async (o) => {
      await o.call('RemoveInput', { inputName: args.source_name })
    })
    await obs.refresh()
    return ok({ scene, source: args.source_name, kind: args.kind })
  }
)

tool('remove_source', 'Delete a source and every scene item that uses it.', { source_name: S('Source name.') }, ['source_name'], async ({ obs, args }) => {
  const res = await obs.call('RemoveInput', { inputName: args.source_name })
  await obs.refresh()
  return res.ok ? ok({ removed: args.source_name }) : fail(res.error)
})

tool(
  'duplicate_source',
  'Duplicate a source in a scene as an independent input with its own settings and transform.',
  { scene_name: S('Scene name.'), source_name: S('Source to duplicate.'), new_name: S('Name for the copy.') },
  ['scene_name', 'source_name', 'new_name'],
  async ({ obs, args }) => {
    const scene = pickScene(obs, args.scene_name)
    if (!scene) return fail(`unknown_scene: ${args.scene_name}`)

    const settings = await obs.call('GetInputSettings', { inputName: args.source_name })
    if (!settings.ok) return fail(`unknown_source: ${args.source_name}`)
    const id = await sceneItemId(obs, scene, args.source_name)
    const transform = id == null ? null : (await obs.call('GetSceneItemTransform', { sceneName: scene, sceneItemId: id })).data?.sceneItemTransform

    const created = await obs.call('CreateInput', {
      sceneName: scene,
      inputName: args.new_name,
      inputKind: settings.data?.inputKind,
      inputSettings: settings.data?.inputSettings ?? {},
      sceneItemEnabled: true
    })
    if (!created.ok) return fail(created.error)

    const newId = await sceneItemId(obs, scene, args.new_name)
    if (transform && newId != null) {
      await obs.call('SetSceneItemTransform', { sceneName: scene, sceneItemId: newId, sceneItemTransform: transform })
    }

    obs.pushUndo(`source-duplicated:${args.new_name}`, async (o) => {
      await o.call('RemoveInput', { inputName: args.new_name })
    })
    await obs.refresh()
    return ok({ scene, from: args.source_name, to: args.new_name })
  }
)

tool(
  'screenshot',
  'Capture a PNG screenshot of a source (or the program scene) to disk.',
  { source_name: S('Source name. Defaults to the program scene.'), path: S('Optional absolute output path.') },
  [],
  async ({ obs, args }) => {
    const target = args.source_name || obs.snapshot.currentScene
    if (!target) return fail('no_source_target')
    const dir = require('node:path').join(require('electron').app.getPath('pictures'), 'Sona')
    require('node:fs').mkdirSync(dir, { recursive: true })
    const file = args.path || require('node:path').join(dir, `shot-${Date.now()}.png`)
    const res = await obs.call('SaveSourceScreenshot', {
      sourceName: target,
      imageFormat: 'png',
      imageFilePath: file
    })
    return res.ok ? ok({ saved: file, source: target }) : fail(res.error)
  }
)

/* --------------------------------- audio ---------------------------------- */

tool(
  'set_volume_percent',
  'Set the volume of an audio input, 0-100 percent.',
  { source_name: S('Audio input name.'), percent: N('0-100') },
  ['source_name', 'percent'],
  async ({ obs, args }) => {
    const target = pickAudio(obs, args.source_name)
    if (!target) return fail(`unknown_audio_source: ${args.source_name}`, { audio: obs.snapshot.audio.map((a) => a.name) })
    const beforeDb = target.volumeDb
    const res = await obs.call('SetInputVolume', {
      inputName: target.name,
      inputVolumeDb: percentToDb(Number(args.percent))
    })
    if (!res.ok) return fail(res.error)
    obs.pushUndo(`volume:${target.name}`, async (o) => {
      await o.call('SetInputVolume', { inputName: target.name, inputVolumeDb: beforeDb })
    })
    obs.refreshSoon()
    return ok({ input: target.name, percent: Math.max(0, Math.min(100, Number(args.percent))) })
  }
)

tool(
  'adjust_volume',
  'Nudge an audio input up or down by a number of decibels, e.g. -3 or +2.5.',
  { source_name: S('Audio input name.'), delta_db: N('Decibel delta.') },
  ['source_name', 'delta_db'],
  async ({ obs, args }) => {
    const target = pickAudio(obs, args.source_name)
    if (!target) return fail(`unknown_audio_source: ${args.source_name}`)
    const next = Math.max(-100, Math.min(0, Number(target.volumeDb) + Number(args.delta_db)))
    await obs.call('SetInputVolume', { inputName: target.name, inputVolumeDb: next })
    obs.pushUndo(`volume:${target.name}`, async (o) => {
      await o.call('SetInputVolume', { inputName: target.name, inputVolumeDb: target.volumeDb })
    })
    obs.refreshSoon()
    return ok({ input: target.name, volumeDb: Math.round(next * 10) / 10, percent: dbToPercent(next) })
  }
)

tool(
  'set_muted',
  'Mute or unmute an audio input.',
  { source_name: S('Audio input name.'), muted: B('true to mute') },
  ['source_name', 'muted'],
  async ({ obs, args }) => {
    const target = pickAudio(obs, args.source_name)
    if (!target) return fail(`unknown_audio_source: ${args.source_name}`)
    const res = await obs.call('SetInputMute', { inputName: target.name, inputMuted: Boolean(args.muted) })
    if (!res.ok) return fail(res.error)
    obs.pushUndo(`mute:${target.name}`, async (o) => {
      await o.call('SetInputMute', { inputName: target.name, inputMuted: target.muted })
    })
    obs.refreshSoon()
    return ok({ input: target.name, muted: Boolean(args.muted) })
  }
)

tool('toggle_mute', 'Flip the mute state of an audio input.', { source_name: S('Audio input name.') }, ['source_name'], async ({ obs, args }) => {
  const target = pickAudio(obs, args.source_name)
  if (!target) return fail(`unknown_audio_source: ${args.source_name}`)
  const next = !target.muted
  await obs.call('SetInputMute', { inputName: target.name, inputMuted: next })
  obs.pushUndo(`mute:${target.name}`, async (o) => {
    await o.call('SetInputMute', { inputName: target.name, inputMuted: target.muted })
  })
  obs.refreshSoon()
  return ok({ input: target.name, muted: next })
})

tool(
  'set_monitor_type',
  'Route an audio input to monitoring: none, monitor-only, or monitor-and-output.',
  {
    source_name: S('Audio input name.'),
    monitor_type: { type: 'string', enum: ['OBS_MONITORING_TYPE_NONE', 'OBS_MONITORING_TYPE_MONITOR_ONLY', 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT'] }
  },
  ['source_name', 'monitor_type'],
  async ({ obs, args }) => {
    const target = pickAudio(obs, args.source_name)
    if (!target) return fail(`unknown_audio_source: ${args.source_name}`)
    const res = await obs.call('SetInputAudioMonitorType', { inputName: target.name, monitorType: args.monitor_type })
    return res.ok ? ok({ input: target.name, monitorType: args.monitor_type }) : fail(res.error)
  }
)

tool(
  'set_audio_sync_offset',
  'Set the audio sync offset of an input in milliseconds (negative or positive).',
  { source_name: S('Audio input name.'), offset_ms: N('Milliseconds.') },
  ['source_name', 'offset_ms'],
  async ({ obs, args }) => {
    const target = pickAudio(obs, args.source_name)
    if (!target) return fail(`unknown_audio_source: ${args.source_name}`)
    const res = await obs.call('SetInputAudioSyncOffset', { inputName: target.name, inputAudioSyncOffset: Math.round(Number(args.offset_ms)) })
    return res.ok ? ok({ input: target.name, offsetMs: Math.round(Number(args.offset_ms)) }) : fail(res.error)
  }
)

tool(
  'set_audio_tracks',
  'Set which OBS audio tracks an input is routed to.',
  {
    source_name: S('Audio input name.'),
    tracks: { type: 'array', items: { type: 'integer' }, description: 'Track numbers 1-6 that should be active.' }
  },
  ['source_name', 'tracks'],
  async ({ obs, args }) => {
    const target = pickAudio(obs, args.source_name)
    if (!target) return fail(`unknown_audio_source: ${args.source_name}`)
    const map = { 1: false, 2: false, 3: false, 4: false, 5: false, 6: false }
    for (const t of args.tracks ?? []) if (map[t] !== undefined) map[t] = true
    const res = await obs.call('SetInputAudioTracks', { inputName: target.name, inputAudioTracks: map })
    return res.ok ? ok({ input: target.name, tracks: map }) : fail(res.error)
  }
)

/* --------------------------------- filters -------------------------------- */

tool(
  'add_filter',
  'Attach a filter to a source, e.g. noise_suppress, compressor, gain, color_correction, crop_filter.',
  {
    source_name: S('Source name.'),
    filter_name: S('Display name for the filter.'),
    kind: S('OBS filter kind, e.g. noise_suppress, compressor_filter, gain_filter, color_filter_v2.'),
    settings: { type: 'object', description: 'Optional initial settings.' }
  },
  ['source_name', 'filter_name', 'kind'],
  async ({ obs, args }) => {
    const res = await obs.call('CreateSourceFilter', {
      sourceName: args.source_name,
      filterName: args.filter_name,
      filterKind: args.kind,
      filterSettings: args.settings ?? {}
    })
    return res.ok ? ok({ source: args.source_name, filter: args.filter_name, kind: args.kind }) : fail(res.error)
  }
)

tool(
  'set_filter_enabled',
  'Enable or disable a filter on a source.',
  { source_name: S('Source name.'), filter_name: S('Filter name.'), enabled: B('true to enable') },
  ['source_name', 'filter_name', 'enabled'],
  async ({ obs, args }) => {
    const res = await obs.call('SetSourceFilterEnabled', {
      sourceName: args.source_name,
      filterName: args.filter_name,
      filterEnabled: Boolean(args.enabled)
    })
    return res.ok ? ok({ filter: args.filter_name, enabled: Boolean(args.enabled) }) : fail(res.error)
  }
)

tool(
  'set_filter_settings',
  'Change settings of an existing filter.',
  {
    source_name: S('Source name.'),
    filter_name: S('Filter name.'),
    settings: { type: 'object', description: 'Partial settings object to merge.' }
  },
  ['source_name', 'filter_name', 'settings'],
  async ({ obs, args }) => {
    const res = await obs.call('SetSourceFilterSettings', {
      sourceName: args.source_name,
      filterName: args.filter_name,
      filterSettings: args.settings
    })
    return res.ok ? ok({ filter: args.filter_name, applied: Object.keys(args.settings ?? {}) }) : fail(res.error)
  }
)

tool(
  'remove_filter',
  'Remove a filter from a source.',
  { source_name: S('Source name.'), filter_name: S('Filter name.') },
  ['source_name', 'filter_name'],
  async ({ obs, args }) => {
    const res = await obs.call('RemoveSourceFilter', { sourceName: args.source_name, filterName: args.filter_name })
    return res.ok ? ok({ removed: args.filter_name }) : fail(res.error)
  }
)

/* --------------------------------- outputs -------------------------------- */

tool('start_streaming', 'Start the live stream.', {}, [], async ({ obs }) => {
  const res = await obs.call('StartStream')
  obs.refreshSoon()
  return res.ok ? ok({ streaming: true }) : fail(res.error)
})

tool('stop_streaming', 'Stop the live stream.', {}, [], async ({ obs }) => {
  const res = await obs.call('StopStream')
  obs.refreshSoon()
  return res.ok ? ok({ streaming: false }) : fail(res.error)
})

tool('stream_caption', 'Send a live closed-caption line to the stream.', { text: S('Caption text.') }, ['text'], async ({ obs, args }) => {
  const res = await obs.call('SendStreamCaption', { captionText: args.text })
  return res.ok ? ok({ sent: true }) : fail(res.error)
})

tool('start_recording', 'Start local recording.', {}, [], async ({ obs }) => {
  const res = await obs.call('StartRecord')
  obs.refreshSoon()
  return res.ok ? ok({ recording: true }) : fail(res.error)
})

tool('stop_recording', 'Stop local recording.', {}, [], async ({ obs }) => {
  const res = await obs.call('StopRecord')
  obs.refreshSoon()
  return res.ok ? ok({ recording: false, path: res.data?.outputPath ?? null }) : fail(res.error)
})

tool('pause_recording', 'Pause or resume the current recording.', { paused: B('true to pause') }, ['paused'], async ({ obs, args }) => {
  const res = await obs.call(args.paused ? 'PauseRecord' : 'ResumeRecord')
  obs.refreshSoon()
  return res.ok ? ok({ paused: Boolean(args.paused) }) : fail(res.error)
})

tool(
  'replay_buffer',
  'Control the replay buffer: start, stop, or save the last N seconds.',
  { action: { type: 'string', enum: ['start', 'stop', 'save'] } },
  ['action'],
  async ({ obs, args }) => {
    const map = { start: 'StartReplayBuffer', stop: 'StopReplayBuffer', save: 'SaveReplayBuffer' }
    const res = await obs.call(map[args.action])
    obs.refreshSoon()
    return res.ok ? ok({ action: args.action, saved: res.data?.savedReplayPath ?? null }) : fail(res.error)
  }
)

tool('virtual_cam', 'Start or stop the OBS virtual camera.', { enabled: B('true to start') }, ['enabled'], async ({ obs, args }) => {
  const res = await obs.call(args.enabled ? 'StartVirtualCam' : 'StopVirtualCam')
  obs.refreshSoon()
  return res.ok ? ok({ virtualCam: Boolean(args.enabled) }) : fail(res.error)
})

tool(
  'media_control',
  'Control a media source: play, pause, restart, stop, next or previous.',
  {
    source_name: S('Media source name.'),
    action: { type: 'string', enum: ['play', 'pause', 'restart', 'stop', 'next', 'previous'] }
  },
  ['source_name', 'action'],
  async ({ obs, args }) => {
    const map = {
      play: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY',
      pause: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE',
      restart: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART',
      stop: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP',
      next: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_NEXT',
      previous: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PREVIOUS'
    }
    const res = await obs.call('TriggerMediaInputAction', { inputName: args.source_name, mediaAction: map[args.action] })
    return res.ok ? ok({ source: args.source_name, action: args.action }) : fail(res.error)
  }
)

tool(
  'set_media_cursor',
  'Seek a media source to a position in milliseconds.',
  { source_name: S('Media source name.'), position_ms: N('Position in milliseconds.') },
  ['source_name', 'position_ms'],
  async ({ obs, args }) => {
    const res = await obs.call('SetMediaInputCursor', {
      inputName: args.source_name,
      mediaCursor: Math.max(0, Math.round(Number(args.position_ms)))
    })
    return res.ok ? ok({ source: args.source_name, positionMs: Number(args.position_ms) }) : fail(res.error)
  }
)

/* -------------------------------- config ---------------------------------- */

tool('get_video_settings', 'Read canvas and output resolution plus FPS.', {}, [], async ({ obs }) => {
  const res = await obs.call('GetVideoSettings')
  return res.ok ? ok(res.data) : fail(res.error)
})

tool(
  'set_video_settings',
  'Change canvas/output resolution or FPS.',
  {
    base_width: N('Canvas width.'),
    base_height: N('Canvas height.'),
    output_width: N('Output width.'),
    output_height: N('Output height.'),
    fps_numerator: N('FPS numerator, e.g. 60.'),
    fps_denominator: N('FPS denominator, usually 1.')
  },
  [],
  async ({ obs, args }) => {
    const current = await obs.call('GetVideoSettings')
    if (!current.ok) return fail(current.error)
    const next = {
      ...current.data,
      ...(args.base_width != null ? { baseWidth: Number(args.base_width) } : {}),
      ...(args.base_height != null ? { baseHeight: Number(args.base_height) } : {}),
      ...(args.output_width != null ? { outputWidth: Number(args.output_width) } : {}),
      ...(args.output_height != null ? { outputHeight: Number(args.output_height) } : {}),
      ...(args.fps_numerator != null ? { fpsNumerator: Number(args.fps_numerator) } : {}),
      ...(args.fps_denominator != null ? { fpsDenominator: Number(args.fps_denominator) } : {})
    }
    const res = await obs.call('SetVideoSettings', next)
    return res.ok ? ok({ applied: Object.keys(next) }) : fail(res.error)
  }
)

tool('list_hotkeys', 'List OBS hotkey names that can be triggered.', {}, [], async ({ obs }) => {
  const res = await obs.call('GetHotkeyList')
  return res.ok ? ok({ hotkeys: res.data?.hotkeys ?? [] }) : fail(res.error)
})

tool('trigger_hotkey', 'Trigger an OBS hotkey by name (from list_hotkeys).', { hotkey_name: S('Hotkey name.') }, ['hotkey_name'], async ({ obs, args }) => {
  const res = await obs.call('TriggerHotkeyByName', { hotkeyName: args.hotkey_name })
  obs.refreshSoon()
  return res.ok ? ok({ triggered: args.hotkey_name }) : fail(res.error)
})

tool('set_profile', 'Switch the active OBS profile.', { profile_name: S('Profile name.') }, ['profile_name'], async ({ obs, args }) => {
  const res = await obs.call('SetCurrentProfile', { profileName: args.profile_name })
  obs.refreshSoon()
  return res.ok ? ok({ profile: args.profile_name }) : fail(res.error)
})

tool('set_scene_collection', 'Switch the active OBS scene collection.', { collection_name: S('Collection name.') }, ['collection_name'], async ({ obs, args }) => {
  const res = await obs.call('SetCurrentSceneCollection', { sceneCollectionName: args.collection_name })
  await obs.refresh()
  return res.ok ? ok({ collection: args.collection_name }) : fail(res.error)
})

/* ---------------------------- safety & recovery --------------------------- */

tool('save_restore_point', 'Snapshot the current layout and audio mix so it can be restored later.', { name: S('Name for this restore point.') }, [], async ({ obs, args }) =>
  obs.saveRestorePoint(args.name)
)

tool('restore_point', 'Restore a previously saved layout and audio mix.', { name: S('Restore point name.') }, ['name'], async ({ obs, args }) =>
  obs.restorePoint(args.name)
)

tool('list_restore_points', 'List saved restore points.', {}, [], async ({ obs }) => ok({ points: obs.listRestorePoints() }))

tool('undo', 'Undo the last reversible change Sona made (scene switch, volume, mute, visibility, transform).', {}, [], async ({ obs }) => obs.undo())

/* ------------------------------- subsystems ------------------------------- */

tool(
  'overlay_show_alert',
  'Fire an on-stream alert in the Sona overlay (follow, sub, raid, cheer).',
  { user: S('Viewer name.'), kind: { type: 'string', enum: ['follow', 'sub', 'raid', 'cheer'] }, message: S('Optional custom text.') },
  ['user'],
  async ({ overlay, args }) => {
    if (!overlay) return fail('overlay_unavailable')
    return overlay.fireAlert({ user: args.user, kind: args.kind ?? 'follow', message: args.message })
  }
)

tool(
  'overlay_set_text',
  'Replace the text of a text element in the overlay.',
  { element_id: S('Element id from the designer.'), text: S('New text. Use {{scene}} for the live scene name.') },
  ['element_id', 'text'],
  async ({ overlay, args }) => (overlay ? overlay.setText(args.element_id, args.text) : fail('overlay_unavailable'))
)

tool('chat_send', 'Send a message to the connected Twitch chat.', { message: S('Message text.') }, ['message'], async ({ chat, args }) =>
  chat ? chat.send(args.message) : fail('chat_unavailable')
)

tool('chat_state', 'Read chat connection state and recent messages.', {}, [], async ({ chat }) =>
  chat
    ? ok({
        connected: chat.connected,
        channel: chat.channel,
        recent: chat.recent(10),
        poll: chat.pollState(),
        giveaway: chat.giveawayState()
      })
    : fail('chat_unavailable')
)

tool(
  'poll_start',
  'Start a chat poll. Viewers vote by typing !1, !2, ...',
  {
    question: S('Poll question.'),
    options: { type: 'array', items: { type: 'string' }, description: '2-6 answer options.' },
    duration_sec: N('How long the poll runs. Default 120.')
  },
  ['question', 'options'],
  async ({ chat, args }) => (chat ? chat.startPoll(args) : fail('chat_unavailable'))
)

tool('poll_stop', 'Close the running poll and announce the winner.', {}, [], async ({ chat }) => (chat ? chat.stopPoll() : fail('chat_unavailable')))

tool(
  'giveaway_start',
  'Start a chat giveaway. Viewers join by typing !join.',
  { prize: S('What is being given away.'), duration_sec: N('Duration. Default 300.') },
  ['prize'],
  async ({ chat, args }) => (chat ? chat.startGiveaway(args) : fail('chat_unavailable'))
)

tool('giveaway_pick', 'Stop the giveaway and pick a random winner from the entrants.', {}, [], async ({ chat }) =>
  chat ? chat.pickWinner() : fail('chat_unavailable')
)

tool(
  'counter_set',
  'Read or change a chat counter, e.g. deaths. Omit value to just read it.',
  { name: S('Counter name.'), value: N('New absolute value. Omit to read.') },
  ['name'],
  async ({ chat, args }) => (chat ? chat.counter(args.name, args.value) : fail('chat_unavailable'))
)

tool(
  'timer_add',
  'Add a recurring chat announcement.',
  { text: S('Announcement text.'), interval_min: N('Minutes between announcements.') },
  ['text', 'interval_min'],
  async ({ chat, args }) => (chat ? chat.addTimer(args.text, args.interval_min) : fail('chat_unavailable'))
)

tool('music_play', 'Play the music queue, or queue and play a query/URL first.', { query: S('Optional search term or URL.') }, [], async ({ music, args }) =>
  music ? music.play(args.query) : fail('music_unavailable')
)

tool('music_pause', 'Pause or resume local music playback.', {}, [], async ({ music }) => (music ? music.pause() : fail('music_unavailable')))

tool('music_next', 'Skip to the next track in the music queue.', {}, [], async ({ music }) => (music ? music.next() : fail('music_unavailable')))

tool('music_volume', 'Set local music volume, 0-100.', { percent: N('0-100') }, ['percent'], async ({ music, args }) =>
  music ? music.setVolume(Number(args.percent)) : fail('music_unavailable')
)

tool('music_queue', 'Read the music queue and what is playing.', {}, [], async ({ music }) => (music ? ok(music.state()) : fail('music_unavailable')))

/* --------------------------- raw protocol escape -------------------------- */

const RAW_PREFIXES = /^(Get|Set|Create|Remove|Duplicate|Trigger|Start|Stop|Toggle|Pause|Resume|Save|Send|Press|Open|Suspend|Sleep|Restart|Split)/

tool(
  'obs_raw_request',
  'Escape hatch: issue any obs-websocket v5 request by name when no dedicated tool exists. Prefer the dedicated tools.',
  {
    request_type: S('Exact v5 request name, e.g. GetSceneItemList.'),
    request_data: { type: 'object', description: 'Request fields.' }
  },
  ['request_type'],
  async ({ obs, args }) => {
    if (!RAW_PREFIXES.test(String(args.request_type ?? ''))) return fail(`request_type_not_allowed: ${args.request_type}`)
    const res = await obs.call(args.request_type, args.request_data ?? {})
    obs.refreshSoon()
    return res.ok ? ok(res.data) : fail(res.error)
  }
)

/* ------------------------------- execution -------------------------------- */

async function executeTool(context, name, args) {
  const entry = tools.find((t) => t.schema.function.name === name)
  if (!entry) return { ok: false, error: `unknown_tool: ${name}` }
  try {
    const result = await entry.run({ ...context, args: args ?? {} })
    return result ?? { ok: true }
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) }
  }
}

function toolSchemas() {
  return tools.map((t) => t.schema)
}

module.exports = { executeTool, toolSchemas, SOURCE_KINDS }
