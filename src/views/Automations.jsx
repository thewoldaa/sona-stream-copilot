import { useEffect, useState } from 'react'

const parseSteps = (text) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const space = line.indexOf(' ')
      if (space < 0) return { tool: line, args: {} }
      const tool = line.slice(0, space).trim()
      const raw = line.slice(space + 1).trim()
      try {
        return { tool, args: raw ? JSON.parse(raw) : {} }
      } catch {
        return { tool, args: {}, invalid: raw }
      }
    })

const formatSteps = (steps) => (steps ?? []).map((s) => `${s.tool} ${JSON.stringify(s.args ?? {})}`).join('\n')

export default function Automations({ sona }) {
  const [state, setState] = useState({ routines: [], reminders: [], savedMessages: [], notes: '' })
  const [routine, setRoutine] = useState({ name: '', trigger: '', steps: '' })
  const [reminder, setReminder] = useState({ text: '', minutes: 10 })
  const [message, setMessage] = useState({ label: '', text: '' })
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    const next = await window.sona.automations.state()
    setState(next)
    setNotes(next.notes ?? '')
  }

  useEffect(() => {
    load()
  }, [])

  async function addRoutine() {
    const steps = parseSteps(routine.steps)
    if (!routine.name.trim() || !steps.length) {
      return sona.notify('Routine butuh nama dan minimal satu langkah.', 'error')
    }
    const invalid = steps.find((s) => s.invalid)
    if (invalid) return sona.notify(`JSON tidak valid di langkah ${invalid.tool}`, 'error')
    setBusy(true)
    await window.sona.automations.saveRoutine({ name: routine.name.trim(), trigger: routine.trigger.trim(), steps })
    setRoutine({ name: '', trigger: '', steps: '' })
    await load()
    setBusy(false)
    sona.notify('Routine disimpan.')
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <h2>Routine</h2>
          <span className="muted tiny">frasa pemicu → rangkaian tool</span>
        </div>
        <p className="muted tiny">
          Satu langkah per baris: <code>nama_tool {'{"arg":"nilai"}'}</code>. Bisa dipanggil dari Asisten
          (“jalankan routine go live”), atau otomatis saat ada pesan chat yang memuat frasa pemicu.
        </p>
        <div className="form">
          <div className="form-row">
            <label>
              <span>Nama</span>
              <input value={routine.name} onChange={(e) => setRoutine({ ...routine, name: e.target.value })} placeholder="Mulai stream" />
            </label>
            <label>
              <span>Frasa chat (opsional)</span>
              <input value={routine.trigger} onChange={(e) => setRoutine({ ...routine, trigger: e.target.value })} placeholder="!start" />
            </label>
          </div>
          <label>
            <span>Langkah</span>
            <textarea
              rows="4"
              value={routine.steps}
              onChange={(e) => setRoutine({ ...routine, steps: e.target.value })}
              placeholder={'switch_scene {"scene_name":"Starting"}\nset_muted {"source_name":"Mic","muted":false}'}
            />
          </label>
          <div className="row">
            <button type="button" className="primary" onClick={addRoutine} disabled={busy}>
              simpan routine
            </button>
          </div>
        </div>

        <ul className="element-list">
          {state.routines.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="element-pick"
                onClick={async () => {
                  const res = await window.sona.automations.run(r.name)
                  sona.notify(res.ok ? `Menjalankan ${r.name}` : res.error, res.ok ? 'info' : 'error')
                }}
                title="jalankan sekarang"
              >
                <span>{r.name}</span>
                <span className="muted tiny">
                  {r.steps?.length ?? 0} langkah{r.trigger ? ` · ${r.trigger}` : ''}
                </span>
              </button>
              <button
                type="button"
                className="ghost tiny-btn"
                onClick={() => setRoutine({ name: r.name, trigger: r.trigger ?? '', steps: formatSteps(r.steps) })}
                title="muat ke editor"
              >
                ✎
              </button>
              <button
                type="button"
                className="ghost tiny-btn"
                onClick={async () => {
                  await window.sona.automations.removeRoutine(r.id)
                  load()
                }}
                title="hapus"
              >
                ✕
              </button>
            </li>
          ))}
          {!state.routines.length && <li className="muted tiny">Belum ada routine.</li>}
        </ul>
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2>Pengingat</h2>
          </div>
          <div className="form">
            <label>
              <span>Teks</span>
              <input value={reminder.text} onChange={(e) => setReminder({ ...reminder, text: e.target.value })} placeholder="Cek bitrate" />
            </label>
            <label>
              <span>Menit dari sekarang</span>
              <input type="number" value={reminder.minutes} onChange={(e) => setReminder({ ...reminder, minutes: Number(e.target.value) })} />
            </label>
            <button
              type="button"
              className="ghost"
              onClick={async () => {
                if (!reminder.text.trim()) return
                await window.sona.automations.addReminder(reminder.text.trim(), reminder.minutes)
                setReminder({ text: '', minutes: 10 })
                load()
                sona.notify('Pengingat dibuat.')
              }}
            >
              tambah pengingat
            </button>
          </div>
          <ul className="steplist">
            {state.reminders
              .filter((r) => !r.done)
              .map((r) => (
                <li key={r.id}>
                  <span className="muted tiny">{new Date(r.due).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span> {r.text}
                  <button
                    type="button"
                    className="ghost tiny-btn"
                    onClick={async () => {
                      await window.sona.automations.removeReminder(r.id)
                      load()
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            {!state.reminders.filter((r) => !r.done).length && <li className="muted tiny">Tidak ada pengingat aktif.</li>}
          </ul>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Pesan tersimpan</h2>
          </div>
          <div className="form">
            <div className="form-row">
              <label>
                <span>Label</span>
                <input value={message.label} onChange={(e) => setMessage({ ...message, label: e.target.value })} placeholder="discord" />
              </label>
              <label>
                <span>Isi</span>
                <input value={message.text} onChange={(e) => setMessage({ ...message, text: e.target.value })} placeholder="join discord di deskripsi" />
              </label>
            </div>
            <button
              type="button"
              className="ghost"
              onClick={async () => {
                if (!message.label.trim() || !message.text.trim()) return
                await window.sona.automations.saveMessage(message.text.trim(), message.label.trim())
                setMessage({ label: '', text: '' })
                load()
              }}
            >
              simpan pesan
            </button>
          </div>
          <ul className="element-list">
            {state.savedMessages.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className="element-pick"
                  onClick={async () => {
                    const res = await window.sona.automations.sendSaved(m.label)
                    sona.notify(res.ok ? `Terkirim: ${m.label}` : res.error, res.ok ? 'info' : 'error')
                  }}
                >
                  <span>{m.label}</span>
                  <span className="muted tiny">{m.text}</span>
                </button>
                <button
                  type="button"
                  className="ghost tiny-btn"
                  onClick={async () => {
                    await window.sona.automations.removeMessage(m.id)
                    load()
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
            {!state.savedMessages.length && <li className="muted tiny">Belum ada pesan tersimpan.</li>}
          </ul>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Catatan</h2>
          <span className="muted tiny">{notes.length} karakter</span>
        </div>
        <div className="form">
          <textarea rows="8" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ide segmen, jadwal, hal yang harus diingat…" />
          <div className="row row--end">
            <button
              type="button"
              className="primary"
              onClick={async () => {
                await window.sona.automations.saveNotes(notes)
                load()
                sona.notify('Catatan disimpan.')
              }}
            >
              simpan catatan
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
