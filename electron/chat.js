'use strict'

const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443'
const MAX_RECENT = 120

/** Parse one raw IRC line: tags, prefix, command, params, trailing text. */
function parseIrcLine(line) {
  const tags = {}
  let rest = line
  if (rest.startsWith('@')) {
    const space = rest.indexOf(' ')
    const rawTags = rest.slice(1, space)
    for (const pair of rawTags.split(';')) {
      const [k, v = ''] = pair.split('=')
      tags[k] = v.replace(/\\s/g, ' ')
    }
    rest = rest.slice(space + 1)
  }

  let prefix = ''
  if (rest.startsWith(':')) {
    const space = rest.indexOf(' ')
    prefix = rest.slice(1, space)
    rest = rest.slice(space + 1)
  }

  const trailingAt = rest.indexOf(' :')
  const head = trailingAt >= 0 ? rest.slice(0, trailingAt) : rest
  const text = trailingAt >= 0 ? rest.slice(trailingAt + 2) : ''
  const [command = '', ...params] = head.split(' ')
  return { tags, prefix, command, params, text }
}

/**
 * Twitch chat over IRC-over-WebSocket. Reading works anonymously; sending and
 * moderation need a user OAuth token (chat:edit, chat:read, moderator:manage:banned_users).
 */
class ChatService {
  #ws = null
  #emit
  #getSettings
  #saveChat
  #getObs
  #ai
  #judge
  #onChatMessage
  #recent = []
  #seen = new Set()
  #poll = null
  #giveaway = null
  #timers = new Map()
  #cooldowns = new Map()
  #reconnectTimer = null
  #reconnectDelay = 2000
  #stopping = false

  constructor({ emit, getSettings, saveChat, getObs, aiComplete, aiJudge, onMessage }) {
    this.#emit = emit ?? (() => {})
    this.#getSettings = getSettings
    this.#saveChat = saveChat ?? (() => {})
    this.#getObs = getObs
    this.#ai = aiComplete
    this.#judge = aiJudge ?? aiComplete
    this.#onChatMessage = onMessage ?? null
    this.connected = false
    this.channel = ''
    this.username = ''
    this.lastError = null
  }

  get settings() {
    return this.#getSettings().chat
  }

  connect({ channel, username, token } = {}) {
    const cfg = this.settings
    const chan = String(channel ?? cfg.channel ?? '').trim().toLowerCase().replace(/^#/, '')
    if (!chan) return { ok: false, error: 'channel_kosong' }

    this.disconnect()
    this.#stopping = false
    this.channel = chan
    this.username = String(username ?? cfg.username ?? '').trim().toLowerCase()

    const ws = new WebSocket(IRC_URL)
    this.#ws = ws

    ws.addEventListener('open', () => {
      this.#reconnectDelay = 2000
      const user = this.username || `justinfan${Math.floor(Math.random() * 80000) + 10000}`
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands')
      if (token) {
        this.username = this.username || ''
        ws.send(`PASS oauth:${String(token).replace(/^oauth:/, '')}`)
        ws.send(`NICK ${this.username || user}`)
      } else {
        ws.send(`NICK ${user}`)
      }
      ws.send(`JOIN #${chan}`)
      this.connected = true
      this.#emit('chat:state', this.state())
    })

    ws.addEventListener('message', (event) => {
      const payload = typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8')
      for (const line of payload.split('\r\n')) {
        if (line) this.#handleLine(line)
      }
    })

    ws.addEventListener('close', () => {
      const wasConnected = this.connected
      this.connected = false
      this.#ws = null
      this.#emit('chat:state', this.state())
      if (!this.#stopping && wasConnected) this.#scheduleReconnect(token)
    })

    ws.addEventListener('error', () => {
      this.lastError = 'websocket_error'
      this.#emit('chat:state', this.state())
    })

    return { ok: true, channel: chan, anonymous: !token }
  }

  #scheduleReconnect(token) {
    clearTimeout(this.#reconnectTimer)
    this.#reconnectTimer = setTimeout(() => {
      if (this.#stopping) return
      this.connect({ channel: this.channel, username: this.username, token })
    }, this.#reconnectDelay)
    this.#reconnectDelay = Math.min(this.#reconnectDelay * 1.6, 30000)
  }

  disconnect() {
    this.#stopping = true
    clearTimeout(this.#reconnectTimer)
    for (const timer of this.#timers.values()) clearInterval(timer.handle)
    this.#timers.clear()
    if (this.#ws) {
      try {
        this.#ws.close()
      } catch {
        /* ignore */
      }
    }
    this.#ws = null
    this.connected = false
    this.#emit('chat:state', this.state())
    return { ok: true }
  }

  state() {
    return {
      connected: this.connected,
      channel: this.channel,
      anonymous: !this.settings.hasToken,
      lastError: this.lastError
    }
  }

  recent(limit = 20) {
    return this.#recent.slice(-limit)
  }

  /* --------------------------------- irc ---------------------------------- */

  #handleLine(line) {
    if (line.startsWith('PING')) {
      this.#ws?.send('PONG :tmi.twitch.tv')
      return
    }

    const { tags, prefix, command, text } = parseIrcLine(line)
    const user = prefix.split('!')[0]

    if (command === 'PRIVMSG') {
      this.#onMessage({ user, displayName: tags['display-name'] || user, text, tags })
      return
    }

    if (command === 'NOTICE' || command === 'USERNOTICE') {
      if (/login authentication failed|improperly formatted auth/i.test(text)) {
        this.lastError = 'auth_gagal'
        this.#emit('chat:state', this.state())
      }
      this.#emit('chat:notice', { command, text })
    }
  }

  #onMessage({ user, displayName, text, tags }) {
    const message = {
      id: tags.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      user,
      displayName,
      text,
      at: Date.now(),
      isMod: tags.mod === '1' || Boolean(tags.badges?.includes('broadcaster')),
      isSub: tags.subscriber === '1'
    }

    if (this.#seen.has(message.id)) return
    this.#seen.add(message.id)
    if (this.#seen.size > 4000) this.#seen = new Set([...this.#seen].slice(-2000))

    this.#recent.push(message)
    if (this.#recent.length > MAX_RECENT) this.#recent.shift()
    this.#emit('chat:message', message)
    try {
      this.#onChatMessage?.(message)
    } catch {
      /* automations must never break chat */
    }

    const verdict = this.classify(message)
    if (verdict && verdict.action !== 'none') {
      if (this.settings.moderation.aiAssist && this.#ai) this.#applyWithAI(message, verdict)
      else this.#applyModeration(message, verdict)
    }

    this.#handleVote(message)
    this.#handleCommand(message)
    this.#maybeReadAloud(message, verdict)
  }

  /* ------------------------------ moderation ------------------------------ */

  /** Public: classify a message without acting on it (used by the UI and tests). */
  classify(message) {
    return this.#moderate(message)
  }

  #moderate(message) {
    const mod = this.settings.moderation
    if (!mod.enabled) return null
    const text = message.text
    const lower = text.toLowerCase()

    for (const word of mod.blacklist ?? []) {
      const needle = String(word || '').toLowerCase().trim()
      if (needle && lower.includes(needle)) {
        return { action: mod.action, reason: `blacklist:${needle}` }
      }
    }

    if (text.length >= (mod.minCapsLength ?? 12)) {
      const letters = text.replace(/[^A-Za-z]/g, '')
      if (letters.length >= 10 && letters.replace(/[^A-Z]/g, '').length / letters.length > (mod.maxCapsPercent ?? 75) / 100) {
        return { action: mod.action, reason: 'caps' }
      }
    }

    if (!mod.allowLinks && /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|id|gg|tv|io|xyz|ru)\b)/i.test(lower)) {
      return { action: mod.action, reason: 'link' }
    }

    const emoteCount = (text.match(/[A-Za-z0-9]{2,}/g) ?? []).filter((w) => /^[A-Z][a-z]+[A-Z]/.test(w)).length
    if (emoteCount > (mod.maxEmotes ?? 8)) return { action: mod.action, reason: 'emote_spam' }

    const symbols = text.replace(/[\p{L}\p{N}\s]/gu, '').length
    if (text.length > 12 && symbols / text.length > (mod.maxSymbolsPercent ?? 40) / 100) {
      return { action: mod.action, reason: 'symbols' }
    }

    return null
  }

  /**
   * Second opinion from the local model before acting. Anything other than an
   * explicit DELETE is treated as HOLD, and a timeout means the rule stands.
   */
  async #applyWithAI(message, verdict) {
    this.#emit('chat:flag', { message, reason: verdict.reason, stage: 'ai-check' })
    try {
      const answer = await Promise.race([
        this.#judge({
          system: 'You are a chat moderation classifier. Reply with exactly DELETE or HOLD.',
          user: `Pesan: "${message.text}" (pelanggaran terdeteksi: ${verdict.reason}). Hapus atau biarkan? Jawab DELETE atau HOLD.`
        }),
        new Promise((resolve) => setTimeout(() => resolve('HOLD'), 4000))
      ])
      if (!/delete/i.test(String(answer))) return
    } catch {
      return
    }
    this.#applyModeration(message, verdict)
  }

  #applyModeration(message, verdict) {
    const mod = this.settings.moderation
    this.#emit('chat:flag', { message, reason: verdict.reason })
    if (!this.settings.hasToken) return
    if (verdict.action === 'delete') this.send(`.delete ${message.id}`)
    else if (verdict.action === 'timeout') this.send(`.timeout ${message.user} ${mod.timeoutSeconds ?? 60} ${verdict.reason}`)
  }

  /* -------------------------------- voting -------------------------------- */

  #handleVote(message) {
    if (!this.#poll?.open) return
    const match = message.text.trim().match(/^!(\d{1,2})$/)
    if (!match) return
    const index = Number(match[1]) - 1
    if (index < 0 || index >= this.#poll.options.length) return
    const already = [...this.#poll.votes.values()].includes(index) && this.#poll.votes.get(message.user) === index
    if (already) return
    this.#poll.votes.set(message.user, index)
    this.#emit('chat:poll', this.#pollView())
  }

  /* ------------------------------- commands ------------------------------- */

  #handleCommand(message) {
    const text = message.text.trim()
    if (!text.startsWith('!')) return
    const [rawName, ...rest] = text.slice(1).split(/\s+/)
    const name = rawName.toLowerCase()
    const arg = rest.join(' ')

    const counters = this.settings.counters ?? []
    const counter = counters.find((c) => c.name.toLowerCase() === name || c.name.toLowerCase() === name.replace(/[+-]$/, ''))
    if (counter) {
      const delta = name.endsWith('+') ? 1 : name.endsWith('-') ? -1 : 0
      if (delta !== 0) {
        this.counter(counter.name, (counter.value ?? 0) + delta)
        this.send(`${counter.name}: ${this.#counterValue(counter.name)}`)
        return
      }
      this.send(`${counter.name}: ${counter.value ?? 0}`)
      return
    }

    const command = (this.settings.commands ?? []).find((c) => c.enabled !== false && c.name.toLowerCase() === name)
    if (command) {
      const key = `cmd:${name}`
      const until = this.#cooldowns.get(key) ?? 0
      if (Date.now() < until) return
      this.#cooldowns.set(key, Date.now() + (command.cooldownSec ?? 20) * 1000)
      this.send(command.reply)
      return
    }

    if (name === 'uptime') {
      this.send(this.#uptimeText())
      return
    }

    if (name === 'join' && this.#giveaway?.open) {
      if (!this.#giveaway.entrants.includes(message.displayName)) {
        this.#giveaway.entrants.push(message.displayName)
        this.#emit('chat:giveaway', this.#giveawayView())
      }
      return
    }

    if (name === 'sona') {
      this.#aiCommand(message, arg)
    }
  }

  async #aiCommand(message, arg) {
    if (!arg) return
    if (!this.#ai) return
    const key = `ai:${message.user}`
    const until = this.#cooldowns.get(key) ?? 0
    if (Date.now() < until) return
    this.#cooldowns.set(key, Date.now() + 20000)
    try {
      const answer = await this.#ai({
        system:
          'Kamu Sona, co-host stream berbahasa Indonesia. Jawab singkat, maksimal dua kalimat, ' +
          'tanpa markdown, tanpa tautan, ramah tapi tidak lebay.',
        user: `${message.displayName}: ${arg}`
      })
      if (answer) this.send(answer.slice(0, 460))
    } catch {
      /* chat AI is best effort */
    }
  }

  #uptimeText() {
    const obs = this.#getObs?.()
    const seconds = obs?.snapshot?.streamTimeSeconds
    if (!seconds) return 'Live belum jalan.'
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    return `Sudah live ${h > 0 ? `${h} jam ` : ''}${m} menit.`
  }

  /* --------------------------------- send --------------------------------- */

  send(text) {
    const body = String(text ?? '').trim()
    if (!body) return { ok: false, error: 'pesan_kosong' }
    if (!this.connected || !this.#ws) return { ok: false, error: 'chat_belum_terhubung' }
    const key = 'send'
    const until = this.#cooldowns.get(key) ?? 0
    if (Date.now() < until) return { ok: false, error: 'rate_limited' }
    this.#cooldowns.set(key, Date.now() + (this.settings.sendCooldownMs ?? 1200))
    this.#ws.send(`PRIVMSG #${this.channel} :${body.slice(0, 480)}`)
    this.#recent.push({ id: `out-${Date.now()}`, user: this.username || 'sona', displayName: 'Sona', text: body, at: Date.now(), outbound: true })
    return { ok: true }
  }

  /* --------------------------------- poll --------------------------------- */

  startPoll({ question, options = [], duration_sec = 120 }) {
    const opts = options.filter(Boolean).slice(0, 6)
    if (opts.length < 2) return { ok: false, error: 'butuh_minimal_2_opsi' }
    clearTimeout(this.#poll?.timer)
    this.#poll = {
      question,
      options: opts,
      votes: new Map(),
      startedAt: Date.now(),
      endsAt: Date.now() + Number(duration_sec) * 1000,
      open: true,
      timer: null
    }
    if (this.connected) {
      const lines = opts.map((o, i) => `${i + 1}) ${o}`).join('  ')
      this.send(`POLL: ${question} — ${lines} (vote !1..!${opts.length}, ${Math.round(Number(duration_sec) / 60) || 1} menit)`)
    }
    this.#poll.timer = setTimeout(() => this.stopPoll(), Number(duration_sec) * 1000)
    this.#emit('chat:poll', this.#pollView())
    return { ok: true, poll: this.#pollView() }
  }

  stopPoll() {
    const poll = this.#poll
    if (!poll) return { ok: false, error: 'tidak_ada_poll' }
    poll.open = false
    clearTimeout(poll.timer)
    const tally = poll.options.map((label, index) => ({
      label,
      votes: [...poll.votes.values()].filter((v) => v === index).length
    }))
    const winner = tally.slice().sort((a, b) => b.votes - a.votes)[0]
    if (this.connected) {
      this.send(`POLL selesai: ${winner.label} menang (${winner.votes} suara).`)
    }
    this.#emit('chat:poll', this.#pollView())
    return { ok: true, result: { question: poll.question, tally, winner } }
  }

  #pollView() {
    if (!this.#poll) return null
    const { options, votes, open, question, endsAt } = this.#poll
    return {
      question,
      open,
      endsAt,
      tally: options.map((label, index) => ({
        label,
        votes: [...votes.values()].filter((v) => v === index).length
      })),
      totalVotes: votes.size
    }
  }

  pollState() {
    return this.#pollView()
  }

  /* ------------------------------- giveaway ------------------------------- */

  startGiveaway({ prize, duration_sec = 300 }) {
    this.#giveaway = {
      prize,
      entrants: [],
      open: true,
      startedAt: Date.now(),
      endsAt: Date.now() + Number(duration_sec) * 1000,
      timer: null
    }
    if (this.connected) this.send(`GIVEAWAY: ${prize} — ketik !join. Durasi ${Math.round(Number(duration_sec) / 60) || 1} menit.`)
    this.#giveaway.timer = setTimeout(() => this.pickWinner(), Number(duration_sec) * 1000)
    this.#emit('chat:giveaway', this.#giveawayView())
    return { ok: true, giveaway: this.#giveawayView() }
  }

  pickWinner() {
    const g = this.#giveaway
    if (!g) return { ok: false, error: 'tidak_ada_giveaway' }
    g.open = false
    clearTimeout(g.timer)
    if (!g.entrants.length) {
      if (this.connected) this.send(`Giveaway ${g.prize} berakhir tanpa peserta.`)
      this.#emit('chat:giveaway', this.#giveawayView())
      return { ok: false, error: 'tanpa_peserta' }
    }
    const winner = g.entrants[Math.floor(Math.random() * g.entrants.length)]
    g.winner = winner
    if (this.connected) this.send(`Selamat ${winner}! Kamu menang ${g.prize}.`)
    this.#emit('chat:giveaway', this.#giveawayView())
    return { ok: true, winner, prize: g.prize }
  }

  #giveawayView() {
    if (!this.#giveaway) return null
    const { prize, entrants, open, winner, endsAt } = this.#giveaway
    return { prize, open, winner: winner ?? null, entrants: entrants.length, endsAt }
  }

  giveawayState() {
    return this.#giveawayView()
  }

  /* -------------------------------- counters ------------------------------- */

  #counterValue(name) {
    const found = (this.settings.counters ?? []).find((c) => c.name === name)
    return found?.value ?? 0
  }

  counter(name, value) {
    const list = this.#getSettings().chat.counters ?? []
    const found = list.find((c) => c.name.toLowerCase() === String(name).toLowerCase())
    if (!found) {
      if (value == null) return { ok: false, error: `counter_tidak_ada: ${name}` }
      const created = { name, value: Number(value) }
      this.#save({ counters: [...list, created] })
      return { ok: true, counter: created }
    }
    if (value == null) return { ok: true, counter: found }
    const next = { ...found, value: Number(value) }
    this.#save({ counters: list.map((c) => (c === found ? next : c)) })
    this.#emit('chat:counters', this.#getSettings().chat.counters)
    return { ok: true, counter: next }
  }

  /* --------------------------------- timers -------------------------------- */

  addTimer(text, intervalMin) {
    const timers = [...(this.#getSettings().chat.timers ?? [])]
    const timer = { id: `t${Date.now().toString(36)}`, text, intervalMin: Number(intervalMin) || 10, enabled: true }
    timers.push(timer)
    this.#save({ timers })
    this.#armTimers()
    return { ok: true, timer }
  }

  setTimerEnabled(id, enabled) {
    const timers = (this.#getSettings().chat.timers ?? []).map((t) => (t.id === id ? { ...t, enabled: Boolean(enabled) } : t))
    this.#save({ timers })
    this.#armTimers()
    return { ok: true }
  }

  removeTimer(id) {
    this.#save({ timers: (this.#getSettings().chat.timers ?? []).filter((t) => t.id !== id) })
    this.#armTimers()
    return { ok: true }
  }

  armTimers() {
    this.#armTimers()
    return { ok: true, count: this.#timers.size }
  }

  #armTimers() {    for (const timer of this.#timers.values()) clearInterval(timer.handle)
    this.#timers.clear()
    for (const timer of this.#getSettings().chat.timers ?? []) {
      if (!timer.enabled) continue
      const handle = setInterval(() => {
        if (this.connected) this.send(timer.text)
      }, Math.max(1, Number(timer.intervalMin) || 10) * 60_000)
      this.#timers.set(timer.id, { handle })
    }
  }

  /* ------------------------------- read aloud ------------------------------ */

  #maybeReadAloud(message, verdict) {
    const voice = this.#getSettings().voice
    if (!voice.readAloud) return
    const cfg = this.settings
    if (verdict && verdict.action !== 'none') return
    if (cfg.readAloudSkipLinks && /https?:\/\//i.test(message.text)) return
    if (cfg.readAloudSkipBots && /(bot|streamlabs|nightbot)/i.test(message.user)) return
    if (message.text.length < (cfg.readAloudMinLength ?? 3)) return
    this.#emit('chat:read', { user: message.displayName, text: message.text })
  }

  #save(patch) {
    this.#saveChat(patch)
  }
}

module.exports = { ChatService, parseIrcLine }
