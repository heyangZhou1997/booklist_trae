import { BrowserWindow, session } from 'electron'

const JD_PARTITION = 'persist:jd'

export function getJdPartition() {
  return JD_PARTITION
}

export async function hasJdLogin(): Promise<boolean> {
  const ses = session.fromPartition(JD_PARTITION)
  const cookies = await ses.cookies.get({})
  return cookies.some(c => {
    if (c.name !== 'pt_key' && c.name !== 'pt_pin') return false
    const domain = (c.domain || '').toLowerCase()
    return domain.includes('jd.com') || domain.includes('3.cn')
  })
}

export async function openJdAuthWindow(
  targetUrl?: string,
  userAgent?: string,
  mode: 'risk' | 'login' = 'risk'
): Promise<boolean> {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    show: true,
    webPreferences: {
      partition: JD_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  const url = targetUrl || 'https://search.jd.com/Search?keyword=9787111558422&enc=utf-8'
  const mobileUa =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
  const defaultUa =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

  const ua =
    userAgent ||
    (url.includes('item.m.jd.com') ? mobileUa : defaultUa)

  win.webContents.setUserAgent(ua)

  return await new Promise<boolean>((resolve) => {
    let resolved = false
    let sawSafePage = false
    let lastUrl = ''
    let urlPoll: NodeJS.Timeout | undefined

    const finish = (ok: boolean) => {
      if (resolved) return
      resolved = true
      if (urlPoll) clearInterval(urlPoll)
      try {
        win.destroy()
      } catch {}
      resolve(ok)
    }

    const isRiskOrLogin = (u: string) =>
      u.includes('passport.jd.com/new/login') || u.includes('cfe.m.jd.com/privatedomain/risk_handler')

    const isSafeJdPage = (u: string) => {
      if (!u) return false
      if (isRiskOrLogin(u)) return false
      try {
        const host = new URL(u).hostname.toLowerCase()
        return host.endsWith('.jd.com') || host === 'jd.com' || host.endsWith('.3.cn') || host === '3.cn'
      } catch {
        return false
      }
    }

    const markIfSafe = () => {
      try {
        const current = win.webContents.getURL() || ''
        lastUrl = current
        if (isSafeJdPage(current)) sawSafePage = true
      } catch {
        // ignore
      }
    }

    win.webContents.on('did-navigate', markIfSafe)
    win.webContents.on('did-navigate-in-page', markIfSafe)
    win.webContents.on('did-frame-finish-load', markIfSafe)

    urlPoll = setInterval(markIfSafe, 300)

    const poll = setInterval(async () => {
      try {
        markIfSafe()
        if (!sawSafePage) return
        const ok = await hasJdLogin()
        if (!ok) return
        clearInterval(poll)
        finish(true)
      } catch {
        // ignore
      }
    }, 1000)

    win
      .loadURL(url)
      .then(() => {
        markIfSafe()
      })
      .catch(() => {
        // ignore load errors; user may close window or JD may block resources
      })

    win.on('closed', async () => {
      clearInterval(poll)
      try {
        const safe = sawSafePage || isSafeJdPage(lastUrl)
        if (mode === 'risk') {
          finish(safe || await hasJdLogin())
          return
        }
        finish((safe && await hasJdLogin()) || await hasJdLogin())
      } catch {
        finish(false)
      }
    })
  })
}

