'use strict'

const { percentToDb } = require('./obs')

const MAX_STEPS = 6

/** Tool surface offered to the model. Every tool maps 1:1 onto an OBS request. */
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_status',
      description: 'Read the current OBS state: scenes, current scene, audio inputs, streaming/recording flags.',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_scenes',
      description: 'List every scene name in the current OBS scene collection.',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'switch_scene',
      description: 'Switch the program (live) scene.',
      parameters: {
        type: 'object',
        properties: { scene_name: { type: 'string', description: 'Exact scene name from list_scenes.' } },
        required: ['scene_name'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_scene_item_visible',
      description: 'Show or hide a source inside a scene.',
      parameters: {
        type: 'object',
        properties: {
          scene_name: { type: 'string' },
          source_name: { type: 'string' },
          visible: { type: 'boolean' }
        },
        required: ['scene_name', 'source_name', 'visible'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_volume_percent',
      description: 'Set the volume of an audio input, 0-100 percent.',
      parameters: {
        type: 'object',
        properties: {
          source_name: { type: 'string' },
          percent: { type: 'number' }
        },
        required: ['source_name', 'percent'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_muted',
      description: 'Mute (true) or unmute (false) an audio input.',
      parameters: {
        type: 'object',
        properties: {
          source_name: { type: 'string' },
          muted: { type: 'boolean' }
        },
        required: ['source_name', 'muted'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'start_streaming',
      description: 'Start the live stream.',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'stop_streaming',
      description: 'Stop the live stream.',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'start_recording',
      description: 'Start local recording.',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'stop_recording',
      description: 'Stop local recording.',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'trigger_transition',
      description: 'Run the current scene transition, or a named one.',
      parameters: {
        type: 'object',
        properties: { transition_name: { type: 'string' } },
        additionalProperties: false
      }
    }
  }
]

function freeform(result) {
  if (!result.ok) return { ok: false, error: result.error ?? 'unknown_error' }
  return { ok: true, data: result.data ?? null }
}

async function executeTool(obs, name, args) {
  const snapshot = obs.snapshot
  const findSceneName = (raw) => {
    if (!raw) return null
    if (snapshot.scenes.includes(raw)) return raw
    const low = String(raw).toLowerCase()
    return snapshot.scenes.find((s) => s.toLowerCase() === low) ?? null
  }

  switch (name) {
    case 'get_status':
      return { ok: true, data: await obs.refresh() }

    case 'list_scenes':
      return { ok: true, data: { scenes: snapshot.scenes, current: snapshot.currentScene } }

    case 'switch_scene': {
      const scene = findSceneName(args.scene_name)
      if (!scene) return { ok: false, error: `unknown_scene: ${args.scene_name}`, scenes: snapshot.scenes }
      return freeform(await obs.call('SetCurrentProgramScene', { sceneName: scene }))
    }

    case 'set_scene_item_visible': {
      const scene = findSceneName(args.scene_name)
      if (!scene) return { ok: false, error: `unknown_scene: ${args.scene_name}` }
      const id = await obs.call('GetSceneItemId', { sceneName: scene, sourceName: args.source_name })
      if (!id.ok) return { ok: false, error: `unknown_source: ${args.source_name}` }
      return freeform(
        await obs.call('SetSceneItemEnabled', {
          sceneName: scene,
          sceneItemId: id.data.sceneItemId,
          sceneItemEnabled: Boolean(args.visible)
        })
      )
    }

    case 'set_volume_percent': {
      const target = findByFuzzy(snapshot.audio, args.source_name)
      if (!target) return { ok: false, error: `unknown_audio_source: ${args.source_name}`, audio: snapshot.audio.map((a) => a.name) }
      return freeform(
        await obs.call('SetInputVolume', {
          inputName: target.name,
          inputVolumeDb: percentToDb(args.percent)
        })
      )
    }

    case 'set_muted': {
      const target = findByFuzzy(snapshot.audio, args.source_name)
      if (!target) return { ok: false, error: `unknown_audio_source: ${args.source_name}` }
      return freeform(await obs.call('SetInputMute', { inputName: target.name, inputMuted: Boolean(args.muted) }))
    }

    case 'start_streaming':
      return freeform(await obs.call('StartStream'))
    case 'stop_streaming':
      return freeform(await obs.call('StopStream'))
    case 'start_recording':
      return freeform(await obs.call('StartRecord'))
    case 'stop_recording':
      return freeform(await obs.call('StopRecord'))
    case 'trigger_transition':
      return freeform(
        await obs.call('TriggerStudioModeTransition').then((r) =>
          r.ok || !args.transition_name
            ? r
            : obs.call('SetCurrentSceneTransition', { transitionName: args.transition_name })
        )
      )
    default:
      return { ok: false, error: `unknown_tool: ${name}` }
  }
}

function findByFuzzy(list, raw) {
  if (!raw) return null
  const low = String(raw).toLowerCase()
  return list.find((a) => a.name === raw) ?? list.find((a) => a.name.toLowerCase() === low) ?? list.find((a) => a.name.toLowerCase().includes(low)) ?? null
}

/** Split an OpenAI-compatible base URL into { endpoint, key }. */
function endpoint(cfg) {
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '')
  return {
    url: `${base}/chat/completions`,
    key: cfg.apiKey || 'local',
    model: cfg.model
  }
}

async function callModel(cfg, messages, signal) {
  const { url, key, model } = endpoint(cfg)
  if (!cfg.baseUrl) throw new Error('AI base URL belum diisi (Settings → AI).')

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, tools: TOOLS, tool_choice: 'auto', temperature: 0.4 }),
    signal
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`model HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  return res.json()
}

/**
 * Run one user turn through the model, executing tools until it answers.
 * Returns { answer, steps: [{ tool, args, result }] }.
 */
async function runCommand({ obs, cfg, text, history = [], onStep }) {
  const messages = [
    { role: 'system', content: cfg.systemPrompt },
    ...history.slice(-8).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: text }
  ]
  const steps = []
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 90_000)

  try {
    for (let i = 0; i < MAX_STEPS; i++) {
      const payload = await callModel(cfg, messages, controller.signal)
      const choice = payload?.choices?.[0]?.message
      if (!choice) throw new Error('model returned no message')

      const toolCalls = choice.tool_calls ?? []
      if (!toolCalls.length) {
        return { answer: String(choice.content ?? '').trim(), steps }
      }

      messages.push({ role: 'assistant', content: choice.content ?? '', tool_calls: toolCalls })
      for (const call of toolCalls) {
        let args = {}
        try {
          args = JSON.parse(call.function.arguments || '{}')
        } catch {
          args = {}
        }
        const result = await executeTool(obs, call.function.name, args)
        const step = { tool: call.function.name, args, result }
        steps.push(step)
        onStep?.(step)
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result).slice(0, 4000)
        })
      }
    }
    return { answer: 'Saya berhenti setelah beberapa langkah — perintahnya terlalu berantai. Coba pecah jadi dua.', steps }
  } finally {
    clearTimeout(timeout)
  }
}

module.exports = { runCommand, TOOLS, executeTool }
