'use strict'

const { executeTool } = require('./tools')

/**
 * Local automations: routines (trigger phrase → ordered tool calls), one-shot
 * reminders, saved chat messages and notes. Everything is stored in settings and
 * runs in the main process; nothing leaves the machine.
 */
class Automations {
  #getSettings
  #save
  #ctx
  #chat
  #overlay
  #emit
  #timer = null

  constructor({ getSettings, save, context, chat, overlay, emit }) {
    this.#getSettings = getSettings
    this.#save = save
    this.#ctx = context
    this.#chat = chat ?? null
    this.#overlay = overlay ?? null
    this.#emit = emit ?? (() => {})
  }

  attach({ chat, overlay }) {
    if (chat) this.#chat = chat
    if (overlay) this.#overlay = overlay
  }

  get cfg() {
    return this.#getSettings().automations
  }

  start() {
    clearInterval(this.#timer)
    this.#timer = setInterval(() => this.tick(), 15000)
    return { ok: true }
  }

  stop() {
    clearInterval(this.#timer)
    this.#timer = null
  }

  /* ------------------------------- routines -------------------------------- */

  routines() {
    return this.cfg.routines ?? []
  }

  runRoutine(nameOrId) {
    const key = String(nameOrId ?? '').toLowerCase().trim()
    const routine = this.routines().find(
      (r) => r.enabled !== false && (r.id === key || r.name.toLowerCase() === key)
    )
    if (!routine) return { ok: false, error: `routine_tidak_ada: ${nameOrId}`, available: this.routines().map((r) => r.name) }
    return this.#execute(routine)
  }

  /** Fire routines whose trigger phrase appears in a chat message. */
  matchChat(text, user) {
    const lower = String(text ?? '').toLowerCase()
    for (const routine of this.routines()) {
      if (routine.enabled === false || !routine.trigger) continue
      if (routine.chatOnly === false) continue
      if (!lower.includes(routine.trigger.toLowerCase())) continue
      this.#execute(routine, { user })
      this.#emit('automations:ran', { routine: routine.name, trigger: routine.trigger })
    }
  }

  async #execute(routine, meta = {}) {
    const results = []
    for (const step of routine.steps ?? []) {
      const result = await executeTool(this.#ctx(), step.tool, step.args ?? {})
      results.push({ tool: step.tool, ok: result?.ok !== false, result })
      if (result?.ok === false && routine.stopOnError !== false) break
    }
    this.#emit('automations:ran', { routine: routine.name, results, ...meta })
    return { ok: true, routine: routine.name, steps: results.length, results }
  }

  saveRoutine(routine) {
    const list = [...this.routines()]
    const id = routine.id ?? `r${Date.now().toString(36)}`
    const next = {
      id,
      name: String(routine.name ?? 'Routine').slice(0, 60),
      trigger: String(routine.trigger ?? '').slice(0, 60),
      enabled: routine.enabled !== false,
      steps: Array.isArray(routine.steps) ? routine.steps.slice(0, 12) : []
    }
    const index = list.findIndex((r) => r.id === id)
    if (index >= 0) list[index] = next
    else list.push(next)
    this.#save({ routines: list })
    return { ok: true, routine: next }
  }

  removeRoutine(id) {
    this.#save({ routines: this.routines().filter((r) => r.id !== id) })
    return { ok: true }
  }

  /* ------------------------------- reminders ------------------------------- */

  reminders() {
    return this.cfg.reminders ?? []
  }

  addReminder(text, minutes) {
    const ms = Math.max(1, Number(minutes) || 1) * 60_000
    const reminder = {
      id: `rem${Date.now().toString(36)}`,
      text: String(text ?? '').slice(0, 200),
      due: Date.now() + ms,
      done: false
    }
    this.#save({ reminders: [...this.reminders(), reminder] })
    return { ok: true, reminder }
  }

  removeReminder(id) {
    this.#save({ reminders: this.reminders().filter((r) => r.id !== id) })
    return { ok: true }
  }

  tick() {
    const now = Date.now()
    const due = this.reminders().filter((r) => !r.done && r.due <= now)
    if (!due.length) return { fired: 0 }
    const chatConnected = Boolean(this.#chat?.connected)
    for (const reminder of due) {
      if (chatConnected) this.#chat.send(reminder.text)
      this.#overlay?.fireAlert?.({ user: 'Pengingat', kind: 'follow', message: reminder.text })
      this.#emit('automations:reminder', reminder)
    }
    this.#save({
      reminders: this.reminders().map((r) => (due.some((d) => d.id === r.id) ? { ...r, done: true } : r))
    })
    return { fired: due.length }
  }

  /* ----------------------------- saved messages ---------------------------- */

  savedMessages() {
    return this.cfg.savedMessages ?? []
  }

  saveMessage(text, label) {
    const entry = { id: `m${Date.now().toString(36)}`, label: String(label ?? 'pesan').slice(0, 40), text: String(text ?? '').slice(0, 400) }
    this.#save({ savedMessages: [...this.savedMessages(), entry] })
    return { ok: true, entry }
  }

  sendSaved(label) {
    const key = String(label ?? '').toLowerCase()
    const entry = this.savedMessages().find((m) => m.label.toLowerCase() === key || m.id === label)
    if (!entry) return { ok: false, error: `pesan_tidak_ada: ${label}`, available: this.savedMessages().map((m) => m.label) }
    return this.#chat?.send(entry.text) ?? { ok: false, error: 'chat_unavailable' }
  }

  removeMessage(id) {
    this.#save({ savedMessages: this.savedMessages().filter((m) => m.id !== id) })
    return { ok: true }
  }

  /* --------------------------------- notes --------------------------------- */

  notes() {
    return this.cfg.notes ?? ''
  }

  saveNotes(text) {
    this.#save({ notes: String(text ?? '').slice(0, 20000) })
    return { ok: true, length: String(text ?? '').length }
  }
}

module.exports = { Automations }
