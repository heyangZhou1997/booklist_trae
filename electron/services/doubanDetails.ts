import { BrowserWindow } from 'electron'

export interface DoubanSubjectDetails {
  isbn?: string
  publisher?: string
  translator?: string
}

export async function fetchDoubanSubjectDetails(detailUrl: string): Promise<DoubanSubjectDetails> {
  if (!detailUrl) return {}

  const win = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    webPreferences: {
      offscreen: true,
      images: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  win.webContents.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  )

  try {
    await win.loadURL(detailUrl)

    await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const start = Date.now();
        const timer = setInterval(() => {
          if (document.querySelector('#info')) { clearInterval(timer); resolve(true); }
          if (Date.now() - start > 6000) { clearInterval(timer); resolve(false); }
        }, 200);
      })
    `)

    const infoText = await win.webContents.executeJavaScript(`(document.querySelector('#info')?.innerText || '').toString()`)
    const details: DoubanSubjectDetails = {}

    if (typeof infoText === 'string' && infoText.trim()) {
      const isbnMatch = infoText.match(/ISBN[:：]\s*([\d-]+)/i)
      if (isbnMatch?.[1]) details.isbn = isbnMatch[1].replace(/-/g, '')

      const publisherMatch = infoText.match(/出版社[:：]\s*([^\n\r]+)/)
      if (publisherMatch?.[1]) details.publisher = publisherMatch[1].trim()

      const translatorMatch = infoText.match(/译者[:：]\s*([^\n\r]+)/)
      if (translatorMatch?.[1]) details.translator = translatorMatch[1].trim()
    }

    return details
  } catch {
    return {}
  } finally {
    win.destroy()
  }
}

