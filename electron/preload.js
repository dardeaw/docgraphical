const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog')
});

ipcRenderer.on('file-loaded', (event, data) => {
  if (window.loadMarkdownContent) {
    window.loadMarkdownContent(data.filePath, data.content);
  }
});
