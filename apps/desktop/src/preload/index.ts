import { contextBridge, ipcRenderer } from 'electron';
import { channels } from '@gestion/contracts/channels';

const allowed = new Set<string>(channels);

contextBridge.exposeInMainWorld('api', {
  invoke(channel: string, input: unknown) {
    if (!allowed.has(channel)) return Promise.reject(new Error('Opération inconnue.'));
    return ipcRenderer.invoke(channel, input);
  },
});
