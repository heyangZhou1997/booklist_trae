import { BrowserWindow } from 'electron'

export interface SearchResult {
  title: string
  author: string
  translator?: string
  publisher?: string
  publishDate?: string
  description?: string
  pageCount?: number
  coverUrl?: string
  isbn?: string
  detailUrl?: string
}

export async function searchGoogleBooks(query: string): Promise<SearchResult[]> {
  const q = query.trim()
  if (!q) return []

  const suggestResults = await searchDoubanSuggest(q)
  if (suggestResults.length >= 3) return suggestResults

  const htmlResults = await searchDoubanHtml(q)
  const merged: SearchResult[] = []
  const seen = new Set<string>()

  const pushUnique = (r: SearchResult) => {
    const key = (r.detailUrl || `${r.title}|${r.author}`).toString()
    if (seen.has(key)) return
    seen.add(key)
    merged.push(r)
  }

  suggestResults.forEach(pushUnique)
  htmlResults.forEach(pushUnique)

  return merged.slice(0, 20)
}

function createHiddenWindow() {
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
  return win
}

async function searchDoubanSuggest(query: string): Promise<SearchResult[]> {
  const win = createHiddenWindow()
  const url = `https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(query)}`

  try {
    await win.loadURL(url)
    const text = await win.webContents.executeJavaScript(`document.body ? document.body.innerText : ''`)
    const data = JSON.parse(text || '[]')
    if (!Array.isArray(data)) return []

    return data
      .filter((x: any) => x && x.title)
      .slice(0, 20)
      .map((x: any) => {
        const author = (x.author_name || x.author || '').toString().trim()
        const detailUrl = x.url || (x.id ? `https://book.douban.com/subject/${x.id}/` : undefined)
        return {
          title: x.title,
          author: author || '未知作者',
          publisher: x.publisher || undefined,
          publishDate: x.year || undefined,
          coverUrl: x.pic || undefined,
          isbn: undefined,
          detailUrl,
        }
      })
  } catch {
    return []
  } finally {
    win.destroy()
  }
}

async function searchDoubanHtml(query: string): Promise<SearchResult[]> {
  const win = createHiddenWindow()
  const url = `https://search.douban.com/book/subject_search?search_text=${encodeURIComponent(query)}&cat=1001`

  try {
    await win.loadURL(url)
    await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const start = Date.now();
        const timer = setInterval(() => {
          if (document.querySelector('.item-root')) { clearInterval(timer); resolve(true); }
          if (Date.now() - start > 5000) { clearInterval(timer); resolve(false); }
        }, 200);
      })
    `)

    const results = await win.webContents.executeJavaScript(`
      (() => {
        try {
          const items = Array.from(document.querySelectorAll('.item-root'));
          return items.map(item => {
            const titleLink = item.querySelector('.title a');
            const title = titleLink ? titleLink.innerText.trim() : '';
            const coverImg = item.querySelector('.cover-link img');
            const coverUrl = coverImg ? coverImg.src : '';

            const abstract = item.querySelector('.abstract');
            const infoText = abstract ? abstract.innerText : '';
            const parts = infoText.split('/').map(p => p.trim());

            let author = '未知作者';
            let publisher = '';
            let publishDate = '';
            let translator = '';

            if (parts.length >= 1) author = parts[0] || '未知作者';

            let publisherIndex = -1;
            for (let i = 0; i < parts.length; i++) {
              if (parts[i].includes('出版社') || parts[i].includes('出版公司') || parts[i].includes('书店')) {
                publisherIndex = i;
                break;
              }
            }

            if (publisherIndex !== -1) {
              publisher = parts[publisherIndex] || '';
              if (publisherIndex > 1) translator = parts.slice(1, publisherIndex).join(' / ');
              if (publisherIndex + 1 < parts.length) publishDate = parts[publisherIndex + 1] || '';
            } else {
              if (parts.length > 3) {
                publisher = parts[2] || '';
                translator = parts[1] || '';
                publishDate = parts[3] || '';
              } else if (parts.length === 3) {
                publisher = parts[1] || '';
                publishDate = parts[2] || '';
              }
            }

            return {
              title,
              author,
              publisher,
              translator,
              publishDate,
              coverUrl,
              detailUrl: titleLink ? titleLink.href : '',
            };
          }).filter(x => x.title).slice(0, 20);
        } catch {
          return [];
        }
      })()
    `)

    return Array.isArray(results) ? results : []
  } catch {
    return []
  } finally {
    win.destroy()
  }
}
