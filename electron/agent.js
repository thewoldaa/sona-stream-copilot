'use strict'

const { executeTool, toolSchemas } = require('./tools')

const MAX_STEPS = 8

function endpoint(cfg) {
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '')
  return {
    url: `${base}/chat/completions`,
    key: cfg.apiKey || 'local',
    model: cfg.model
  }
}

async function callModel(cfg, messages, signal) {
  if (!cfg.baseUrl) throw new Error('Base URL model belum diisi (Setelan → Model AI).')
  const { url, key, model } = endpoint(cfg)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages,
      tools: toolSchemas(),
      tool_choice: 'auto',
      temperature: Number(cfg.temperature ?? 0.4)
    }),
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
async function runCommand({ obs, context = {}, cfg, text, history = [], onStep }) {
  const messages = [
    { role: 'system', content: cfg.systemPrompt },
    ...history.slice(-8).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: text }
  ]
  const steps = []
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 120_000)

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
        const result = await executeTool({ obs, ...context }, call.function.name, args)
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
    return {
      answer: 'Saya berhenti setelah beberapa langkah — perintahnya terlalu berantai. Coba pecah jadi dua.',
      steps
    }
  } finally {
    clearTimeout(timeout)
  }
}

/** One-shot text completion with no tools — used by chat commands and AI moderation. */
async function complete(cfg, { system, user, temperature = 0.3, maxTokens = 220 }) {
  const { url, key, model } = endpoint(cfg)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature,
      max_tokens: maxTokens
    })
  })
  if (!res.ok) throw new Error(`model HTTP ${res.status}`)
  const body = await res.json()
  return String(body?.choices?.[0]?.message?.content ?? '').trim()
}

module.exports = { runCommand, complete, MAX_STEPS }
