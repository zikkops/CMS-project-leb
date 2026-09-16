// The setup screen's bridge to the app — owner's decisions S29–S30.
//
// Only the app's own setup.html gets it. Every page in the window runs this
// file, including the POS, which comes from the network; a POS page must never
// be able to switch this PC between online till and café hub. main.js checks the
// sender again for every call, so this is the first check, not the only one.

'use strict'

const { contextBridge, ipcRenderer } = require('electron')

if (location.protocol === 'file:' && location.pathname.endsWith('/setup.html')) {
  contextBridge.exposeInMainWorld('counterSetup', {
    current: () => ipcRenderer.invoke('setup:current'),
    choose: mode => ipcRenderer.invoke('setup:choose', mode),
    close: () => ipcRenderer.invoke('setup:close'),
  })
}
