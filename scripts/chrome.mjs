// Finds a Chrome-family browser for the headless scripts (screenshots, icons). Set CHROME_PATH to override.
import fs from 'node:fs'
import path from 'node:path'

export function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const pf = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)
  const candidates = {
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
    win32: pf.flatMap((d) => [path.join(d, 'Google/Chrome/Application/chrome.exe'), path.join(d, 'Microsoft/Edge/Application/msedge.exe'), path.join(d, 'BraveSoftware/Brave-Browser/Application/brave.exe')]),
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge'],
  }[process.platform] ?? []
  const hit = candidates.find((p) => fs.existsSync(p))
  if (!hit) throw new Error('No Chrome, Chromium, Edge or Brave found. Install one or set CHROME_PATH.')
  return hit
}
// GPU flags per OS for WebGL in headless mode
export const gpuArgs = () => ['--enable-webgl', '--ignore-gpu-blocklist', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])]
