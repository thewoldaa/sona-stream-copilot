'use strict'

const { contextBridge, ipcRenderer } = require('electron')

/** Whitelisted push channels — the renderer never sees a raw ipcRenderer. */
const EVENTS = new Set([
  'obs:status',
  'obs:snapshot',
  'ai:step',
  'voice:hotkey',
  'chat:state',
  'chat:message',
  'chat:flag',
  'chat:notice',
  'chat:poll',
  'chat:giveaway',
  'chat:counters',
  'chat:read',
  'music:state',
  'music:play',
  'music:pause',
  'music:resume',
  'music:volume',
  'music:sink',
  'orb:state',
  'orb:popup'
])

contextBridge.exposeInMainWorld('sona', {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (patch) => ipcRenderer.invoke('settings:save', patch),
    path: () => ipcRenderer.invoke('settings:path')
  },
  secrets: {
    save: (patch) => ipcRenderer.invoke('secrets:save', patch),
    status: () => ipcRenderer.invoke('secrets:status'),
    clear: () => ipcRenderer.invoke('secrets:clear')
  },
  obs: {
    connect: (cfg) => ipcRenderer.invoke('obs:connect', cfg),
    disconnect: () => ipcRenderer.invoke('obs:disconnect'),
    status: () => ipcRenderer.invoke('obs:status'),
    snapshot: () => ipcRenderer.invoke('obs:snapshot'),
    call: (requestType, requestData) => ipcRenderer.invoke('obs:call', { requestType, requestData }),
    detect: () => ipcRenderer.invoke('obs:detect'),
    undo: () => ipcRenderer.invoke('obs:undo')
  },
  ai: {
    command: (text, history) => ipcRenderer.invoke('ai:command', { text, history }),
    test: () => ipcRenderer.invoke('ai:test')
  },
  stt: {
    transcribe: (buffer, mime) => ipcRenderer.invoke('stt:transcribe', { buffer, mime })
  },
  chat: {
    connect: (cfg) => ipcRenderer.invoke('chat:connect', cfg),
    disconnect: () => ipcRenderer.invoke('chat:disconnect'),
    state: () => ipcRenderer.invoke('chat:state'),
    send: (text) => ipcRenderer.invoke('chat:send', text),
    poll: (payload) => ipcRenderer.invoke('chat:poll', payload),
    giveaway: (payload) => ipcRenderer.invoke('chat:giveaway', payload),
    counter: (payload) => ipcRenderer.invoke('chat:counter', payload),
    timer: (payload) => ipcRenderer.invoke('chat:timer', payload)
  },
  overlay: {
    start: () => ipcRenderer.invoke('overlay:start'),
    stop: () => ipcRenderer.invoke('overlay:stop'),
    state: () => ipcRenderer.invoke('overlay:state'),
    update: (elements) => ipcRenderer.invoke('overlay:update', elements),
    alert: (payload) => ipcRenderer.invoke('overlay:alert', payload),
    pickImage: () => ipcRenderer.invoke('overlay:pickImage')
  },
  music: {
    state: () => ipcRenderer.invoke('music:state'),
    addFiles: () => ipcRenderer.invoke('music:addFiles'),
    addPath: (paths) => ipcRenderer.invoke('music:addPath', paths),
    play: (query) => ipcRenderer.invoke('music:play', query),
    pause: () => ipcRenderer.invoke('music:pause'),
    next: () => ipcRenderer.invoke('music:next'),
    previous: () => ipcRenderer.invoke('music:previous'),
    jump: (index) => ipcRenderer.invoke('music:jump', index),
    volume: (percent) => ipcRenderer.invoke('music:volume', percent),
    loop: (mode) => ipcRenderer.invoke('music:loop', mode),
    shuffle: (on) => ipcRenderer.invoke('music:shuffle', on),
    sink: (sinkId) => ipcRenderer.invoke('music:sink', sinkId),
    clear: () => ipcRenderer.invoke('music:clear'),
    remove: (id) => ipcRenderer.invoke('music:remove', id),
    ended: () => ipcRenderer.invoke('music:ended'),
    setPlaying: (value) => ipcRenderer.invoke('music:setPlaying', value)
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url)
  },
  onboarding: {
    save: (patch) => ipcRenderer.invoke('onboarding:save', patch)
  },
  orb: {
    state: () => ipcRenderer.invoke('orb:state'),
    toggle: (enabled) => ipcRenderer.invoke('orb:toggle', enabled),
    visibility: (visible) => ipcRenderer.invoke('orb:visibility', visible),
    snap: (corner) => ipcRenderer.invoke('orb:snap', corner),
    setState: (state) => ipcRenderer.invoke('orb:setState', state),
    popup: (payload) => ipcRenderer.invoke('orb:popup', payload),
    voiceToggle: () => ipcRenderer.invoke('orb:voiceToggle'),
    hide: () => ipcRenderer.invoke('orb:hide')
  },
  on: (channel, handler) => {
    if (!EVENTS.has(channel)) return () => {}
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
})
