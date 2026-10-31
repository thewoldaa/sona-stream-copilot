'use strict'

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')

/**
 * Local overlay server. OBS adds http://127.0.0.1:<port>/overlay as a Browser
 * Source; the page renders the designer elements and receives live state over
 * Server-Sent Events. Nothing leaves the machine.
 */
class OverlayServer {
  #server = null
  #clients = new Set()
  #getSettings
  #saveOverlay
  #getChat
  #getMusic
  #getObs
  #alert = null
  #alertTimer = null

  constructor({ getSettings, saveOverlay, getChat, getMusic, getObs }) {
    this.#getSettings = getSettings
    this.#saveOverlay = saveOverlay ?? (() => {})
    this.#getChat = getChat
    this.#getMusic = getMusic
    this.#getObs = getObs
    this.port = null
  }

  get running() {
    return Boolean(this.#server)
  }

  url() {
    return this.running ? `http://127.0.0.1:${this.port}/overlay` : null
  }

  assetsDir() {
    const dir = path.join(app.getPath('userData'), 'overlay-assets')
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  async start(port) {
    if (this.#server) await this.stop()
    const wanted = Number(port) || 8787

    for (const candidate of [wanted, wanted + 1, wanted + 2, 0]) {
      const server = http.createServer((req, res) => this.#handle(req, res))
      const ok = await new Promise((resolve) => {
        server.once('error', () => resolve(false))
        server.listen(candidate, '127.0.0.1', () => resolve(true))
      })
      if (ok) {
        this.#server = server
        this.port = server.address().port
        this.broadcast()
        return { ok: true, url: this.url(), port: this.port }
      }
    }
    return { ok: false, error: 'port_unavailable' }
  }

  async stop() {
    for (const res of this.#clients) {
      try {
        res.end()
      } catch {
        /* ignore */
      }
    }
    this.#clients.clear()
    const server = this.#server
    this.#server = null
    this.port = null
    if (server) await new Promise((resolve) => server.close(() => resolve()))
    return { ok: true }
  }

  setEnabled(enabled) {
    return enabled ? this.start(this.#getSettings().overlay.port) : this.stop()
  }

  /* -------------------------------- state -------------------------------- */

  #state() {
    const overlay = this.#getSettings().overlay
    const obs = this.#getObs?.()
    const chat = this.#getChat?.()
    const music = this.#getMusic?.()
    const scene = obs?.snapshot?.currentScene ?? '—'

    return {
      at: Date.now(),
      size: { width: overlay.width ?? 1920, height: overlay.height ?? 1080 },
      elements: (overlay.elements ?? []).map((el) => ({
        ...el,
        text: String(el.text ?? '').replaceAll('{{scene}}', scene)
      })),
      scene,
      chat: (chat?.recent?.(6) ?? []).map((m) => ({ user: m.displayName ?? m.user, text: m.text })),
      poll: chat?.pollState?.() ?? null,
      giveaway: chat?.giveawayState?.() ?? null,
      music: music?.state?.() ?? null,
      alert: this.#alert
    }
  }

  broadcast() {
    const payload = `data: ${JSON.stringify(this.#state())}\n\n`
    for (const res of this.#clients) {
      try {
        res.write(payload)
      } catch {
        this.#clients.delete(res)
      }
    }
  }

  fireAlert({ user, kind = 'follow', message }) {
    const label = { follow: 'follow', sub: 'subscribe', raid: 'raid', cheer: 'cheer' }[kind] ?? 'follow'
    this.#alert = {
      user,
      kind,
      text: message || `${user} ${label}!`,
      until: Date.now() + 6000
    }
    clearTimeout(this.#alertTimer)
    this.#alertTimer = setTimeout(() => {
      this.#alert = null
      this.broadcast()
    }, 6200)
    this.broadcast()
    return { ok: true, alert: this.#alert }
  }

  setText(elementId, text) {
    const overlay = this.#getSettings().overlay
    const elements = (overlay.elements ?? []).map((el) => (el.id === elementId ? { ...el, text } : el))
    if (!elements.some((el) => el.id === elementId)) return { ok: false, error: `unknown_element: ${elementId}` }
    this.#saveOverlay({ elements })
    this.broadcast()
    return { ok: true, elementId, text }
  }

  updateElements(elements) {
    this.#saveOverlay({ elements: Array.isArray(elements) ? elements : [] })
    this.broadcast()
    return { ok: true, count: elements?.length ?? 0 }
  }

  /* ------------------------------- transport ------------------------------ */

  #handle(req, res) {
    const url = new URL(req.url, `http://127.0.0.1:${this.port}`)

    if (url.pathname === '/' || url.pathname === '/overlay') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(OVERLAY_HTML)
      return
    }

    if (url.pathname === '/state') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(this.#state()))
      return
    }

    if (url.pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      })
      res.write(`data: ${JSON.stringify(this.#state())}\n\n`)
      this.#clients.add(res)
      const keepAlive = setInterval(() => {
        try {
          res.write(': ping\n\n')
        } catch {
          clearInterval(keepAlive)
        }
      }, 15000)
      req.on('close', () => {
        clearInterval(keepAlive)
        this.#clients.delete(res)
      })
      return
    }

    if (url.pathname.startsWith('/assets/')) {
      const name = path.basename(decodeURIComponent(url.pathname.slice('/assets/'.length)))
      const file = path.join(this.assetsDir(), name)
      if (!file.startsWith(this.assetsDir()) || !fs.existsSync(file)) {
        res.writeHead(404).end('not found')
        return
      }
      const type = file.endsWith('.png')
        ? 'image/png'
        : file.endsWith('.jpg') || file.endsWith('.jpeg')
          ? 'image/jpeg'
          : file.endsWith('.webp')
            ? 'image/webp'
            : 'application/octet-stream'
      res.writeHead(200, { 'Content-Type': type })
      fs.createReadStream(file).pipe(res)
      return
    }

    res.writeHead(404).end('not found')
  }
}

const OVERLAY_HTML = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<title>Sona Overlay</title>
<style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
  body { font-family: "Golos Text", "Inter", "Segoe UI", system-ui, sans-serif; color: #ECEAF4; }
  #stage { position: absolute; inset: 0; transform-origin: top left; }
  .el { position: absolute; box-sizing: border-box; }
  .text { white-space: pre-wrap; line-height: 1.25; }
  .chat { display: flex; flex-direction: column; gap: 8px; }
  .chat .msg { display: flex; gap: 10px; align-items: baseline; }
  .chat .who { font-weight: 700; }
  .alert { text-align: center; transition: opacity 240ms ease, transform 240ms ease; }
  .alert.hidden { opacity: 0; transform: translateY(12px) scale(0.98); }
  .alert .bubble {
    display: inline-block; padding: 18px 34px; border-radius: 16px;
    background: rgba(14,15,18,0.82); border: 1px solid rgba(184,146,255,0.55);
    box-shadow: 0 20px 60px rgba(0,0,0,0.55);
  }
  .timer, .nowplaying { font-variant-numeric: tabular-nums; }
  .poll { background: rgba(14,15,18,0.72); border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; padding: 16px 20px; }
  .poll .row { display: flex; justify-content: space-between; gap: 16px; padding: 3px 0; }
  .poll .bar { height: 6px; background: #B892FF; border-radius: 99px; margin-top: 4px; }
  .image { object-fit: contain; }
</style>
</head>
<body>
<div id="stage"></div>
<script>
  var stage = document.getElementById('stage');
  var state = { elements: [], size: { width: 1920, height: 1080 } };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }

  function fit() {
    var w = state.size.width || 1920, h = state.size.height || 1080;
    var scale = Math.min(window.innerWidth / w, window.innerHeight / h);
    stage.style.width = w + 'px';
    stage.style.height = h + 'px';
    stage.style.transform = 'scale(' + scale + ')';
  }

  function renderPoll(poll) {
    if (!poll) return '';
    var max = Math.max.apply(null, poll.tally.map(function (t) { return t.votes; }).concat([1]));
    return '<div class="poll"><div style="font-weight:700;margin-bottom:8px">' + esc(poll.question) + '</div>' +
      poll.tally.map(function (t) {
        return '<div class="row"><span>' + esc(t.label) + '</span><span>' + t.votes + '</span></div>' +
          '<div class="bar" style="width:' + Math.round((t.votes / max) * 100) + '%;opacity:' + (poll.open ? 1 : 0.45) + '"></div>';
      }).join('') + '</div>';
  }

  function render(el) {
    var base = 'left:' + (el.x || 0) + 'px;top:' + (el.y || 0) + 'px;width:' + (el.width || 400) + 'px;' +
      (el.height ? 'height:' + el.height + 'px;' : '') +
      'color:' + (el.color || '#ECEAF4') + ';font-size:' + (el.fontSize || 28) + 'px;' +
      'font-weight:' + (el.weight || 500) + ';text-align:' + (el.align || 'left') + ';' +
      (el.opacity != null ? 'opacity:' + el.opacity + ';' : '') +
      (el.visible === false ? 'display:none;' : '');

    if (el.type === 'text') return '<div class="el text" style="' + base + '">' + esc(el.text) + '</div>';

    if (el.type === 'chat') {
      var lines = (state.chat || []).slice(-(el.lines || 5));
      return '<div class="el chat" style="' + base + '">' + lines.map(function (m) {
        return '<div class="msg"><span class="who" style="color:' + (el.accent || '#B892FF') + '">' + esc(m.user) + '</span>' +
          '<span>' + esc(m.text) + '</span></div>';
      }).join('') + '</div>';
    }

    if (el.type === 'alert') {
      var alert = state.alert;
      var text = alert ? alert.text : '';
      return '<div class="el alert ' + (alert ? '' : 'hidden') + '" style="' + base + '">' +
        '<div class="bubble">' + esc(text) + '</div></div>';
    }

    if (el.type === 'poll') return '<div class="el" style="' + base + '">' + renderPoll(state.poll) + '</div>';

    if (el.type === 'nowplaying') {
      var track = state.music && state.music.current ? state.music.current.title : '—';
      return '<div class="el nowplaying" style="' + base + '">' + esc((el.text || 'Sedang diputar') + ': ' + track) + '</div>';
    }

    if (el.type === 'clock') {
      return '<div class="el timer" style="' + base + '">' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + '</div>';
    }

    if (el.type === 'scene') {
      return '<div class="el" style="' + base + '">' + esc((el.text || '{{scene}}').replace('{{scene}}', state.scene)) + '</div>';
    }

    if (el.type === 'image') {
      return el.src ? '<img class="el image" style="' + base + '" src="' + esc(el.src) + '" />' : '';
    }

    return '';
  }

  function paint() {
    fit();
    stage.innerHTML = (state.elements || []).map(render).join('');
  }

  if (window.EventSource) {
    var es = new EventSource('/events');
    es.onmessage = function (e) {
      try { state = JSON.parse(e.data); paint(); } catch (err) {}
    };
  } else {
    setInterval(function () {
      fetch('/state').then(function (r) { return r.json(); }).then(function (s) { state = s; paint(); });
    }, 1500);
  }

  setInterval(paint, 1000);
  window.addEventListener('resize', fit);
</script>
</body>
</html>`

module.exports = { OverlayServer }
