// The only things the UI is allowed to ask the main process for.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tink', {
  getLibrary: () => ipcRenderer.invoke('getLibrary'),
  getCover: (id) => ipcRenderer.invoke('getCover', id),
  launch: (id) => ipcRenderer.invoke('launch', id),
});
