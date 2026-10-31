import { useState } from 'react'

const pctToDb = (pct) => (pct <= 0 ? -100 : (pct / 100) * 100 - 100)

export default function Dashboard({ sona, onCommand }) {
  const [text, setText] = useState('')
  const { snapshot, connected } = sona

  async function act(requestType, requestData) {
    const res = await window.sona.obs.call(requestType, requestData)
    if (!res.ok) sona.notify(res.error, 'error')
    setTimeout(() => sona.refresh(), 250)
  }

  return (
    <div className="stack">
      <section className="card card--lead">
        <label className="eyebrow" htmlFor="quick">
          perintah cepat
        </label>
        <form
          className="command"
          onSubmit={(event) => {
            event.preventDefault()
            if (!text.trim()) return
            onCommand(text.trim())
            setText('')
          }}
        >
          <input
            id="quick"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='mis. "pindah ke scene Starting lalu mute mic"'
            autoComplete="off"
          />
          <button type="submit" disabled={!connected || sona.busy}>
            {sona.busy ? '…' : 'kirim'}
          </button>
        </form>
        <p className="muted tiny">
          {connected
            ? 'Perintah diterjemahkan jadi tool call OBS, bukan teks bebas.'
            : 'OBS belum terhubung — buka tab OBS untuk menyambungkan.'}
        </p>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Output</h2>
          <span className="muted tiny">{snapshot?.updatedAt ? new Date(snapshot.updatedAt).toLocaleTimeString() : '—'}</span>
        </div>
        <div className="row">
          <button
            className={snapshot?.streaming ? 'danger' : 'primary'}
            onClick={() => act(snapshot?.streaming ? 'StopStream' : 'StartStream')}
            disabled={!connected}
            type="button"
          >
            {snapshot?.streaming ? 'stop stream' : 'start stream'}
          </button>
          <button
            className={snapshot?.recording ? 'danger' : 'ghost'}
            onClick={() => act(snapshot?.recording ? 'StopRecord' : 'StartRecord')}
            disabled={!connected}
            type="button"
          >
            {snapshot?.recording ? 'stop rekam' : 'mulai rekam'}
          </button>
          <button className="ghost" onClick={() => act('TriggerStudioModeTransition')} disabled={!connected} type="button">
            transisi
          </button>
          <button
            className="ghost"
            onClick={() => act(snapshot?.replayBuffer ? 'StopReplayBuffer' : 'StartReplayBuffer')}
            disabled={!connected}
            type="button"
          >
            {snapshot?.replayBuffer ? 'stop replay' : 'replay buffer'}
          </button>
          <button
            className="ghost"
            onClick={() => act(snapshot?.virtualCam ? 'StopVirtualCam' : 'StartVirtualCam')}
            disabled={!connected}
            type="button"
          >
            {snapshot?.virtualCam ? 'stop vcam' : 'virtual cam'}
          </button>
          <button className="ghost" onClick={sona.undo} disabled={!connected || !sona.status?.undoDepth} type="button">
            undo{sona.status?.undoDepth ? ` (${sona.status.undoDepth})` : ''}
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Scene</h2>
          <span className="muted tiny">klik untuk pindah program</span>
        </div>
        <div className="chips">
          {(snapshot?.scenes ?? []).map((scene) => (
            <button
              key={scene}
              type="button"
              className={`chip ${scene === snapshot?.currentScene ? 'chip--on' : ''}`}
              onClick={() => act('SetCurrentProgramScene', { sceneName: scene })}
              disabled={!connected}
            >
              {scene}
            </button>
          ))}
          {!snapshot?.scenes?.length && <p className="muted tiny">Belum ada scene terbaca.</p>}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Audio</h2>
          <span className="muted tiny">volume & mute langsung ke OBS</span>
        </div>
        <div className="mixer">
          {(snapshot?.audio ?? []).map((input) => (
            <div className="mixer-row" key={input.name}>
              <button
                type="button"
                className={`mute ${input.muted ? 'mute--on' : ''}`}
                onClick={() => act('SetInputMute', { inputName: input.name, inputMuted: !input.muted })}
                disabled={!connected}
                title={input.muted ? 'unmute' : 'mute'}
              >
                {input.muted ? 'muted' : 'live'}
              </button>
              <span className="mixer-name">{input.name}</span>
              <input
                type="range"
                min="0"
                max="100"
                value={input.volumePct}
                onChange={(e) => act('SetInputVolume', { inputName: input.name, inputVolumeDb: pctToDb(Number(e.target.value)) })}
                disabled={!connected}
              />
              <span className="mixer-val">{input.volumePct}%</span>
            </div>
          ))}
          {!snapshot?.audio?.length && <p className="muted tiny">Belum ada input audio terbaca.</p>}
        </div>
      </section>
    </div>
  )
}
