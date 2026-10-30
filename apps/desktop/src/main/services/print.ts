import { BrowserWindow } from 'electron';
import { AppError } from '../core/errors';

/** Ouvre le dialogue d'impression du système sur une fenêtre isolée, sans script ni accès à Node. */
export async function printHtml(html: string): Promise<void> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
  });
  try {
    await window.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html).toString('base64')}`);
    await new Promise<void>((resolve, reject) => {
      window.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
        // Fermer le dialogue n'est pas une panne.
        if (success || reason === 'Print job canceled' || reason === 'cancelled') resolve();
        else reject(new AppError('INTERNAL', `Impression impossible : ${reason}`));
      });
    });
  } finally {
    window.destroy();
  }
}

/** Rend un document en PDF, sans script ni accès à Node. */
export async function htmlToPdf(html: string): Promise<Buffer> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
  });
  try {
    await window.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html).toString('base64')}`);
    return await window.webContents.printToPDF({ pageSize: 'A4', margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 } });
  } finally {
    window.destroy();
  }
}
