import { describe, expect, it } from 'vitest';
import { isSameFileUrl } from './rendererUrl';

describe('isSameFileUrl', () => {
  const windowsFile = 'C:\\Users\\Jean Luc\\AppData\\Local\\Programs\\Glotta\\resources\\app.asar\\out\\renderer\\index.html';
  const windowsUrl = 'file:///C:/Users/Jean%20Luc/AppData/Local/Programs/Glotta/resources/app.asar/out/renderer/index.html';

  it('accepte la page installée sous Windows', () => {
    expect(isSameFileUrl(windowsUrl, windowsFile, true)).toBe(true);
    expect(isSameFileUrl(`${windowsUrl}#/ventes`, windowsFile, true)).toBe(true);
    expect(isSameFileUrl(windowsUrl.replace('C:', 'c:'), windowsFile, true)).toBe(true);
  });

  it('refuse sous Windows tout autre fichier, partage réseau ou protocole', () => {
    expect(isSameFileUrl('file:///C:/Users/Public/index.html', windowsFile, true)).toBe(false);
    expect(isSameFileUrl('file://serveur/C$/Users/Jean%20Luc/index.html', windowsFile, true)).toBe(false);
    expect(isSameFileUrl(windowsUrl.replace('file:', 'https:'), windowsFile, true)).toBe(false);
  });

  it('accepte le même fichier sous Linux et respecte la casse', () => {
    expect(isSameFileUrl('file:///opt/Glotta/index.html', '/opt/Glotta/index.html', false)).toBe(true);
    expect(isSameFileUrl('file:///opt/glotta/index.html', '/opt/Glotta/index.html', false)).toBe(false);
  });

  it('refuse une adresse illisible', () => {
    expect(isSameFileUrl('pas une adresse', windowsFile, true)).toBe(false);
  });
});
