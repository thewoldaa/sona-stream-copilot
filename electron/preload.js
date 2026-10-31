'use strict'

const { contextBridge, ipcRenderer } = require('electron')

/** Whitelisted push channels — the renderer never sees a raw ipcRenderer. */
const EVENTS = new Set(['obs:status', 'obs:snapshot', 'ai:step', 'voice:hotkey'])

contextBridge.exposeInMainWorld('sona', {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (patch) => ipcRenderer.invoke('settings:save', patch),
    path: () => ipcRenderer.invoke('settings:path')
  },
  obs: {
    connect: (cfg) => ipcRenderer.invoke('obs:connect', cfg),
    disconnect: () => ipcRenderer.invoke('obs:disconnect'),
    status: () => ipcRenderer.invoke('obs:status'),
    snapshot: () => ipcRenderer.invoke('obs:snapshot'),
    call: (requestType, requestData) => ipcRenderer.invoke('obs:call', { requestType, requestData })
  },
  ai: {
    command: (text, history) => ipcRenderer.invoke('ai:command', { text, history }),
    test: () => ipcRenderer.invoke('ai:test')
  },
  stt: {
    transcribe: (buffer, mime) => ipcRenderer.invoke('stt:transcribe', { buffer, mime })
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url)
  },
  on: (channel, handler) => {
    if (!EVENTS.has(channel)) return () => {}
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
})
