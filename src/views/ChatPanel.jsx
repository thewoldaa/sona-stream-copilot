import { useEffect, useRef, useState } from 'react'

export default function ChatPanel({ sona }) {
  const cfg = sona.settings?.chat ?? {}
  const [form, setForm] = useState({ channel: cfg.channel ?? '', username: cfg.username ?? '', token: '' })
  const [text, setText] = useState('')
  const [pollForm, setPollForm] = useState({ question: '', options: '', duration: 120 })
  const [giveawayForm, setGiveawayForm] = useState({ prize: '', duration: 300 })
  const feedRef = useRef(null)

  useEffect(() => {
    setForm((prev) => ({ ...prev, channel: cfg.channel ?? '', username: cfg.username ?? '' }))
  }, [cfg.channel, cfg.username])

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight })
  }, [sona.chatMessages])

  async function saveMod(patch) {
    await sona.saveSettings({ chat: { ...cfg, moderation: { ...cfg.moderation, ...patch } } })
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <h2>Koneksi Twitch</h2>
          <span className={`pill ${sona.chatState?.connected ? 'pill--ok' : 'pill--off'}`}>
            {sona.chatState?.connected ? `#${sona.chatState.channel}` : 'offline'}
          </span>
        </div>
        <p className="muted tiny">
          Tanpa token: mode baca (chat terbaca, tidak bisa kirim atau hapus). Dengan token OAuth (scope{' '}
          <code>chat:read chat:edit moderator:manage:banned_users</code>): Sona bisa mengirim dan menghapus pesan.
        </p>
        <div className="form">
          <div className="form-row">
            <label>
              <span>Channel</span>
              <input value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} placeholder="namachannel" />
            </label>
            <label>
              <span>Username bot</span>
              <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="akunbot" />
            </label>
          </div>
          <label>
            <span>OAuth token {cfg.hasToken ? '(sudah tersimpan terenkripsi)' : '(opsional)'}</span>
            <input
              type="password"
              value={form.token}
              onChange={(e) => setForm({ ...form, token: e.target.value })}
              placeholder={cfg.hasToken ? '•••••••• tersimpan' : 'oauth:xxxxxxxxxxxxxxxxxxxx'}
            />
          </label>
          <div className="row">
            <button type="button" className="primary" onClick={() => sona.chatConnect(form)}>
              sambungkan
            </button>
            <button type="button" className="ghost" onClick={sona.chatDisconnect} disabled={!sona.chatState?.connected}>
              putuskan
            </button>
            {sona.chatState?.lastError && <span className="bad tiny">{sona.chatState.lastError}</span>}
          </div>
        </div>
      </section>

      <section className="card card--grow">
        <div className="card-head">
          <h2>Chat langsung</h2>
          <span className="muted tiny">{sona.chatMessages.length} pesan · {sona.chatFlags.length} ditandai</span>
        </div>

        <div className="filters-bar">
          <label className="check tiny">
            <input
              type="checkbox"
              checked={Boolean(cfg.moderation?.enabled)}
              onChange={(e) => saveMod({ enabled: e.target.checked })}
            />
            <span>moderasi lokal</span>
          </label>
          <label className="check tiny">
            <input type="checkbox" checked={Boolean(cfg.moderation?.allowLinks)} onChange={(e) => saveMod({ allowLinks: e.target.checked })} />
            <span>izinkan link</span>
          </label>
          <label className="check tiny">
            <input type="checkbox" checked={Boolean(sona.settings?.voice?.readAloud)} onChange={(e) => sona.saveSettings({ voice: { ...sona.settings.voice, readAloud: e.target.checked } })} />
            <span>baca pesan (TTS)</span>
          </label>
          <select
            value={cfg.moderation?.action ?? 'delete'}
            onChange={(e) => saveMod({ action: e.target.value })}
            className="mini-select"
          >
            <option value="none">hanya tandai</option>
            <option value="delete">hapus pesan</option>
            <option value="timeout">timeout</option>
          </select>
        </div>

        <div className="log log--chat" ref={feedRef}>
          {!sona.chatMessages.length && (
            <div className="empty">
              <p>Belum ada pesan.</p>
              <p className="muted tiny">Sambungkan channel untuk melihat chat masuk.</p>
            </div>
          )}
          {sona.chatMessages.map((m) => (
            <div key={m.id} className={`chat-line ${m.outbound ? 'chat-line--out' : ''}`}>
              <span className="chat-who" style={{ color: m.outbound ? 'var(--accent)' : undefined }}>
                {m.displayName ?? m.user}
              </span>
              <span className="chat-text">{m.text}</span>
            </div>
          ))}
        </div>

        <form
          className="command command--sticky"
          onSubmit={(event) => {
            event.preventDefault()
            const body = text.trim()
            if (!body) return
            setText('')
            sona.chatSend(body)
          }}
        >
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Kirim pesan ke chat…" />
          <button type="submit" disabled={!sona.chatState?.connected}>
            kirim
          </button>
        </form>
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2>Polling</h2>
            {sona.poll?.open && <span className="pill pill--ok">jalan</span>}
          </div>
          <div className="form">
            <label>
              <span>Pertanyaan</span>
              <input value={pollForm.question} onChange={(e) => setPollForm({ ...pollForm, question: e.target.value })} />
            </label>
            <label>
              <span>Opsi (pisahkan koma)</span>
              <input value={pollForm.options} onChange={(e) => setPollForm({ ...pollForm, options: e.target.value })} placeholder="map 1, map 2, map 3" />
            </label>
            <label>
              <span>Durasi (detik)</span>
              <input type="number" value={pollForm.duration} onChange={(e) => setPollForm({ ...pollForm, duration: Number(e.target.value) })} />
            </label>
            <div className="row">
              <button
                type="button"
                className="primary"
                onClick={() =>
                  window.sona.chat.poll({
                    question: pollForm.question,
                    options: pollForm.options.split(',').map((s) => s.trim()).filter(Boolean),
                    duration_sec: pollForm.duration
                  })
                }
              >
                mulai poll
              </button>
              <button type="button" className="ghost" onClick={() => window.sona.chat.poll({ stop: true })}>
                stop
              </button>
            </div>
            {sona.poll && (
              <div className="poll-view">
                <p className="tiny">{sona.poll.question}</p>
                {sona.poll.tally.map((t) => (
                  <div className="poll-row" key={t.label}>
                    <span>{t.label}</span>
                    <span className="muted">{t.votes}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Giveaway</h2>
            {sona.giveaway?.open && <span className="pill pill--ok">{sona.giveaway.entrants} peserta</span>}
          </div>
          <div className="form">
            <label>
              <span>Hadiah</span>
              <input value={giveawayForm.prize} onChange={(e) => setGiveawayForm({ ...giveawayForm, prize: e.target.value })} />
            </label>
            <label>
              <span>Durasi (detik)</span>
              <input type="number" value={giveawayForm.duration} onChange={(e) => setGiveawayForm({ ...giveawayForm, duration: Number(e.target.value) })} />
            </label>
            <div className="row">
              <button type="button" className="primary" onClick={() => window.sona.chat.giveaway({ prize: giveawayForm.prize, duration_sec: giveawayForm.duration })}>
                mulai (!join)
              </button>
              <button type="button" className="ghost" onClick={() => window.sona.chat.giveaway({ stop: true })}>
                pilih pemenang
              </button>
            </div>
            {sona.giveaway?.winner && <p className="ok tiny">Pemenang: {sona.giveaway.winner}</p>}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Counter & timer</h2>
          <span className="muted tiny">dipicu dari chat: !nama, !nama+, !nama-</span>
        </div>
        <div className="row row--wrap">
          {(cfg.counters ?? []).map((c) => (
            <button
              key={c.name}
              type="button"
              className="chip"
              onClick={() => window.sona.chat.counter({ name: c.name, value: (c.value ?? 0) + 1 })}
              title="klik untuk menambah"
            >
              {c.name} · {c.value ?? 0}
            </button>
          ))}
          {(cfg.timers ?? []).map((t) => (
            <button
              key={t.id}
              type="button"
              className={`chip ${t.enabled ? 'chip--on' : ''}`}
              onClick={() => window.sona.chat.timer({ action: 'toggle', id: t.id, enabled: !t.enabled })}
              title={t.text}
            >
              ⏱ {t.intervalMin}m
            </button>
          ))}
        </div>
      </section>

      {sona.chatFlags.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>Ditandai moderasi</h2>
          </div>
          <ul className="steplist">
            {sona.chatFlags.slice(-8).map((flag, i) => (
              <li key={i}>
                <code>{flag.reason}</code> <span className="muted tiny">{flag.message.displayName}: {flag.message.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
