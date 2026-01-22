import { BrowserWindow, net, session } from 'electron'
import { getJdPartition } from './jdAuth'

export interface JDPriceInfo {
  price: number
  originalPrice?: number
  inStock: boolean
  isSelfOperated: boolean
  url: string
  sku: string
}

export type JDFetchResult =
  | JDPriceInfo
  | { noPriceReason: 'no_self' | 'no_price', debug?: any }

type NetHeaders = {
  userAgent?: string
  referer?: string
  accept?: string
}

async function fetchTextViaNet(
  url: string,
  timeoutMs: number,
  redirectLeft = 3
  ,
  headers: NetHeaders = {}
): Promise<{ statusCode?: number, url: string, body: string | null, location?: string, error?: string } | null> {
  const ses = session.fromPartition(getJdPartition())
  return await new Promise<{ statusCode?: number, url: string, body: string | null, location?: string, error?: string } | null>((resolve) => {
    const req = net.request({ url, session: ses })
    req.setHeader(
      'User-Agent',
      headers.userAgent ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    )
    req.setHeader('Accept', headers.accept || 'application/json,text/plain,*/*')
    req.setHeader('Referer', headers.referer || 'https://item.jd.com/')

    const timer = setTimeout(() => {
      try {
        req.abort()
      } catch {}
      resolve({ url, body: null, error: 'timeout' })
    }, timeoutMs)

    req.on('response', (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      res.on('end', () => {
        clearTimeout(timer)
        const statusCode = res.statusCode || 0
        const locationHeader = (res.headers?.location || res.headers?.Location) as string | string[] | undefined
        const location = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader

        if (statusCode >= 300 && statusCode < 400 && location && redirectLeft > 0) {
          const nextUrl = location.startsWith('http') ? location : new URL(location, url).toString()
          fetchTextViaNet(nextUrl, timeoutMs, redirectLeft - 1, headers).then(resolve).catch(() => resolve(null))
          return
        }

        const body = Buffer.concat(chunks).toString('utf8')
        resolve({ statusCode, url, body: statusCode >= 200 && statusCode < 300 ? body : null, location })
      })
    })

    req.on('error', () => {
      clearTimeout(timer)
      resolve({ url, body: null, error: 'error' })
    })

    req.end()
  })
}

function parseJdMobilePrice(html: string): { price?: number, originalPrice?: number, shopName?: string } {
  const shopMatch = html.match(/"shopName"\s*:\s*"([^"]+)"/)
  const shopName = shopMatch ? shopMatch[1] : undefined

  const priceMatch =
    html.match(/"jdprice_amount"\s*:\s*"([\d.]+)"/) ||
    html.match(/"jdPrice"\s*:\s*"([\d.]+)"/)

  const price = priceMatch ? parseFloat(priceMatch[1]) : undefined

  const originalMatch =
    html.match(/"salePrice"\s*:\s*"([\d.]+)"/) ||
    html.match(/"originPrice"\s*:\s*"([\d.]+)"/) ||
    html.match(/"ORIGINAL"\s*:\s*\{[^}]*"salePrice"\s*:\s*"([\d.]+)"/)

  const originalPrice = originalMatch ? parseFloat(originalMatch[1]) : undefined

  return {
    price: price && isFinite(price) ? price : undefined,
    originalPrice: undefined,
    shopName,
  }
}

function parseSkuFromAny(input: string): string | null {
  const s = (input || '').toString()
  const m =
    s.match(/item\.jd\.com\/(\d{5,20})\.html/i) ||
    s.match(/product\/(\d{5,20})\.html/i) ||
    s.match(/[?&]skuId=(\d{5,20})/i) ||
    s.match(/\b(\d{5,20})\b/)
  return m ? m[1] : null
}

export async function fetchJdPriceBySku(skuOrUrl: string): Promise<JDFetchResult | null> {
  const sku = parseSkuFromAny(skuOrUrl)
  if (!sku) return null

  const debug: any = { sku, stage: 'init_sku' }

  try {
    const pc = await fetchJdPriceBySkuViaPcWindowInternal(sku, false)
    if (pc && !(pc as any).noPriceReason) {
      debug.stage = 'ok'
      debug.price = (pc as any).price
      debug.priceSource = 'pc_dom'
      console.log('[JD]', JSON.stringify(debug))
      return pc as any
    }
  } catch (e: any) {
    if ((e?.message || '').includes('JD_LOGIN_REQUIRED') || (e?.message || '').includes('JD_RISK_REQUIRED')) {
      throw e
    }
  }

  const priceApiUrl = `https://p.3.cn/prices/mgets?skuIds=J_${encodeURIComponent(sku)}`
  const netRes = await fetchTextViaNet(priceApiUrl, 2500)
  debug.priceApi = {
    url: priceApiUrl,
    statusCode: netRes?.statusCode,
    finalUrl: netRes?.url,
    location: netRes?.location,
    bodySnippet: netRes?.body ? netRes.body.slice(0, 180) : null,
    error: netRes?.error || (!netRes ? 'no_response' : null),
  }

  let p = 0
  let op = 0
  if (netRes?.body) {
    try {
      const priceJson = JSON.parse(netRes.body)
      const row = Array.isArray(priceJson) ? priceJson[0] : null
      p = row && row.p ? parseFloat(row.p) : 0
      op = row && row.op ? parseFloat(row.op) : 0
    } catch {
      // ignore
    }
  }

  if (p && isFinite(p) && p > 0) {
    const info: JDPriceInfo = {
      price: p,
      inStock: true,
      isSelfOperated: true,
      url: `https://item.jd.com/${sku}.html`,
      sku,
    }
    debug.stage = 'ok'
    debug.price = p
    debug.priceSource = 'p3cn'
    console.log('[JD]', JSON.stringify(debug))
    return info
  }

  const mobileUa =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
  const mobileUrl = `https://item.m.jd.com/product/${encodeURIComponent(sku)}.html`
  const mobileRes = await fetchTextViaNet(mobileUrl, 10000, 3, {
    userAgent: mobileUa,
    referer: mobileUrl,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  })
  const mobileHtml = mobileRes?.body || ''
  const parsed = mobileHtml ? parseJdMobilePrice(mobileHtml) : {}

  debug.mobileFallback = {
    url: mobileUrl,
    statusCode: mobileRes?.statusCode,
    error: mobileRes?.error || (!mobileRes ? 'no_response' : null),
    shopName: parsed.shopName,
    snippet: mobileHtml ? mobileHtml.slice(0, 180) : null,
  }

  const isSelf = mobileHtml.includes('自营') || ((parsed.shopName || '').includes('自营'))
  if (!isSelf) {
    const winRes = await fetchJdPriceBySkuViaMobileWindow(sku)
    if (winRes && !(winRes as any).noPriceReason) {
      debug.stage = 'ok'
      debug.price = (winRes as any).price
      debug.priceSource = 'mobile_dom'
      console.log('[JD]', JSON.stringify(debug))
      return winRes as any
    }

    debug.stage = 'no_self'
    console.log('[JD]', JSON.stringify(debug))
    return { noPriceReason: 'no_self' as const, debug }
  }

  const mp = parsed.price || 0
  const mop = parsed.originalPrice || 0
  if (!mp || !isFinite(mp) || mp <= 0) {
    debug.stage = 'no_price'
    console.log('[JD]', JSON.stringify(debug))
    return { noPriceReason: 'no_price' as const, debug }
  }

  const info: JDPriceInfo = {
    price: mp,
    inStock: true,
    isSelfOperated: true,
    url: `https://item.jd.com/${sku}.html`,
    sku,
  }
  debug.stage = 'ok'
  debug.price = mp
  debug.priceSource = 'mobile_html'
  console.log('[JD]', JSON.stringify(debug))
  return info
}

async function fetchJdPriceBySkuViaMobileWindow(sku: string): Promise<JDFetchResult | null> {
  const mobileUa =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
  const mobileUrl = `https://item.m.jd.com/product/${encodeURIComponent(sku)}.html`

  const win = new BrowserWindow({
    width: 420,
    height: 860,
    show: false,
    webPreferences: {
      offscreen: true,
      images: false,
      partition: getJdPartition(),
    },
  })

  try {
    win.webContents.setUserAgent(mobileUa)
    await loadUrlWithTimeout(win, mobileUrl, 15000)

    const finalUrl = win.webContents.getURL()
    if (finalUrl.includes('passport.jd.com/new/login')) throw new Error('JD_LOGIN_REQUIRED')
    if (finalUrl.includes('cfe.m.jd.com/privatedomain/risk_handler')) throw new Error('JD_RISK_REQUIRED')

    const extracted = await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const start = Date.now();
        const pickPrice = () => {
          const els = Array.from(document.querySelectorAll('[id*="price"], [class*="price"], .p-price, .price'));
          const texts = els.map(el => (el.innerText || el.textContent || '')).join(' ');
          const withCurrency = texts.match(/[¥￥]\\s*(\\d+(?:\\.\\d{1,2})?)/);
          if (withCurrency) return parseFloat(withCurrency[1]);
          const fallback = texts.match(/\\b(\\d+\\.\\d{1,2})\\b/);
          if (fallback) return parseFloat(fallback[1]);
          return 0;
        };
        const pickShop = () => {
          const els = Array.from(document.querySelectorAll('[class*="shop"], [id*="shop"]'));
          const text = els.map(el => (el.innerText || el.textContent || '')).join(' ');
          return text || (document.body ? (document.body.innerText || '') : '');
        };
        const timer = setInterval(() => {
          const price = pickPrice();
          const shopText = pickShop();
          if (price > 0 && isFinite(price)) {
            clearInterval(timer);
            resolve({ price, shopText: (shopText || '').slice(0, 300) });
            return;
          }
          if (Date.now() - start > 12000) {
            clearInterval(timer);
            resolve({ price: 0, shopText: (shopText || '').slice(0, 300) });
          }
        }, 250);
      })
    `)

    const price = extracted?.price ? Number(extracted.price) : 0
    const shopText = (extracted?.shopText || '').toString()
    if (!price || !isFinite(price) || price <= 0) {
      return { noPriceReason: 'no_price' as const }
    }
    const isSelf = shopText.includes('自营')
    if (!isSelf) return { noPriceReason: 'no_self' as const }

    const info: JDPriceInfo = {
      price,
      inStock: true,
      isSelfOperated: true,
      url: `https://item.jd.com/${sku}.html`,
      sku,
    }
    return info
  } finally {
    win.destroy()
  }
}

export async function fetchJdPriceBySkuInteractive(skuOrUrl: string): Promise<JDFetchResult | null> {
  const sku = parseSkuFromAny(skuOrUrl)
  if (!sku) return null
  return fetchJdPriceBySkuViaPcWindowInternal(sku, true)
}

async function fetchJdPriceBySkuViaPcWindowInternal(sku: string, interactive: boolean): Promise<JDFetchResult | null> {
  const ua =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  const url = `https://item.jd.com/${encodeURIComponent(sku)}.html`

  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    show: interactive,
    webPreferences: {
      partition: getJdPartition(),
    },
  })

  try {
    win.webContents.setUserAgent(ua)
    console.log('[JD]', JSON.stringify({ sku, stage: interactive ? 'pc_interactive_open' : 'pc_hidden_open', url }))

    try {
      await loadUrlWithTimeout(win, url, 20000)
    } catch {
      if (!interactive) throw new Error('JD_RISK_REQUIRED')
    }

    const maxWaitMs = interactive ? 180000 : 12000
    const start = Date.now()

    const extractOnce = async () => {
      try {
        const currentUrl = win.webContents.getURL() || ''
        const data = await win.webContents.executeJavaScript(`
          (() => {
            const sku = ${JSON.stringify(sku)};
            const pick = () => {
              const el =
                document.querySelector('.p-price .price') ||
                document.querySelector('.summary-price .p-price span') ||
                document.querySelector('.J-p-' + sku) ||
                document.querySelector('[class*="J-p-"]') ||
                document.querySelector('[data-price]');
              const raw = el ? ((el.innerText || el.textContent || el.getAttribute('data-price') || '') + '') : '';
              const m1 = raw.match(/[¥￥]\\s*(\\d+(?:\\.\\d{1,2})?)/);
              if (m1) return parseFloat(m1[1]);
              const m2 = raw.match(/(\\d+(?:\\.\\d{1,2})?)/);
              if (m2) return parseFloat(m2[1]);
              const bodyText = (document.body ? (document.body.innerText || document.body.textContent || '') : '').toString();
              const m3 = bodyText.match(/[¥￥]\\s*(\\d+(?:\\.\\d{1,2})?)/);
              if (m3) return parseFloat(m3[1]);
              return 0;
            };
            const shopText = () => {
              const el = document.querySelector('#crumb-wrap') || document.querySelector('#popbox') || document.body;
              const txt = el ? ((el.innerText || el.textContent || '') + '') : '';
              return txt.replace(/\\s+/g,' ').slice(0, 500);
            };
            const price = pick();
            return { price, shopText: shopText() };
          })()
        `)
        return {
          url: currentUrl,
          price: data?.price ? Number(data.price) : 0,
          shopText: (data?.shopText || '').toString(),
        }
      } catch {
        return { url: '', price: 0, shopText: '' }
      }
    }

    const result = await new Promise<{ price: number, shopText: string, lastUrl: string }>((resolve) => {
      let lastUrl = ''
      const timer = setInterval(async () => {
        if (win.isDestroyed()) {
          clearInterval(timer)
          resolve({ price: 0, shopText: '', lastUrl })
          return
        }
        const snapshot = await extractOnce()
        if (snapshot.url) lastUrl = snapshot.url
        if (snapshot.price > 0 && isFinite(snapshot.price)) {
          clearInterval(timer)
          resolve({ price: snapshot.price, shopText: snapshot.shopText, lastUrl })
          return
        }
        if (Date.now() - start > maxWaitMs) {
          clearInterval(timer)
          resolve({ price: 0, shopText: snapshot.shopText, lastUrl })
        }
      }, 600)

      win.on('closed', () => {
        clearInterval(timer)
        resolve({ price: 0, shopText: '', lastUrl })
      })
    })

    if (result.price <= 0) {
      console.log('[JD]', JSON.stringify({ sku, stage: interactive ? 'pc_interactive_no_price' : 'pc_hidden_no_price', lastUrl: result.lastUrl }))
      return { noPriceReason: 'no_price' as const }
    }

    const info: JDPriceInfo = {
      price: result.price,
      inStock: true,
      isSelfOperated: true,
      url,
      sku,
    }
    console.log('[JD]', JSON.stringify({ sku, stage: interactive ? 'pc_interactive_ok' : 'pc_hidden_ok', price: result.price, lastUrl: result.lastUrl }))
    return info
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

async function loadUrlWithTimeout(win: BrowserWindow, url: string, timeoutMs: number) {
  const timeoutError = Object.assign(new Error('JD_LOAD_TIMEOUT'), { url })
  await Promise.race([
    win.loadURL(url),
    new Promise<void>((_, reject) => {
      const t = setTimeout(() => {
        try {
          win.webContents.stop()
        } catch {}
        reject(timeoutError)
      }, timeoutMs)
      win.webContents.once('did-finish-load', () => clearTimeout(t))
      win.webContents.once('did-fail-load', () => clearTimeout(t))
      win.webContents.once('destroyed', () => clearTimeout(t))
    }),
  ])
}

export async function fetchJdPrice(isbn: string): Promise<JDFetchResult | null> {
  const trimmed = (isbn || '').trim()
  if (!trimmed) return null

  const debug: any = { isbn: trimmed, stage: 'init' }
  const overallTimeoutMs = 45000

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false, // Hidden window
    webPreferences: {
      offscreen: true,
      images: false, // Disable images for speed
      partition: getJdPartition(),
    }
  })

  const overallTimeout: Promise<JDFetchResult> = new Promise((resolve) => {
    setTimeout(
      () => resolve({ noPriceReason: 'no_price' as const, debug: { ...debug, stage: 'overall_timeout' } }),
      overallTimeoutMs
    )
  })

  const run = async (): Promise<JDFetchResult | null> => {
    win.webContents.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    )

    // 1. Search for the book
    const searchUrl = `https://search.jd.com/Search?keyword=${encodeURIComponent(trimmed)}&enc=utf-8`
    try {
      debug.stage = 'load_search'
      console.log('[JD]', JSON.stringify({ ...debug, msg: 'load search start' }))
      await loadUrlWithTimeout(win, searchUrl, 15000)
    } catch (e: any) {
      const url = typeof e?.url === 'string' ? e.url : ''
      if (url.includes('passport.jd.com/new/login')) {
        throw new Error('JD_LOGIN_REQUIRED')
      }
      if (url.includes('cfe.m.jd.com/privatedomain/risk_handler')) {
        throw new Error('JD_RISK_REQUIRED')
      }
      if ((e?.message || '').toString().includes('JD_LOAD_TIMEOUT')) {
        console.log('[JD]', JSON.stringify({ ...debug, stage: 'load_search_timeout', url: searchUrl }))
        return null
      }
      throw e
    }

    const finalUrl = win.webContents.getURL()
    debug.searchUrl = searchUrl
    debug.searchFinalUrl = finalUrl
    if (finalUrl.includes('passport.jd.com/new/login')) {
      throw new Error('JD_LOGIN_REQUIRED')
    }
    if (finalUrl.includes('cfe.m.jd.com/privatedomain/risk_handler')) {
      throw new Error('JD_RISK_REQUIRED')
    }

    // Wait for list to load (up to 6s)
    const hasResults = await win.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const start = Date.now();
        const timer = setInterval(() => {
          if (document.querySelector('li[data-sku]') || document.querySelector('[data-sku]') || document.querySelector('.gl-item')) { clearInterval(timer); resolve(true); }
          if (Date.now() - start > 6000) { clearInterval(timer); resolve(false); }
        }, 200);
      })
    `)

    if (!hasResults) {
      debug.stage = 'no_results'
      debug.page = await win.webContents.executeJavaScript(`
        (() => {
          const title = (document.title || '').toString().slice(0, 120);
          const text = (document.body ? (document.body.innerText || '') : '').toString().replace(/\\s+/g, ' ').slice(0, 220);
          const skuCount = document.querySelectorAll('li[data-sku]').length;
          const anySkuCount = document.querySelectorAll('[data-sku]').length;
          return { title, text, skuCount, anySkuCount };
        })()
      `)
      const title = (debug.page?.title || '').toString()
      const text = (debug.page?.text || '').toString()
      if (title.includes('商品搜索') && (text.includes('访问频繁') || text.includes('无法搜索') || text.includes('请稍后再试'))) {
        debug.blocked = 'search_rate_limited'
      }
      console.log('[JD]', JSON.stringify(debug))
      return { noPriceReason: 'no_price', debug }
    }

    // Find first self-operated sku from search result list
    const picked = await win.webContents.executeJavaScript(`
      (() => {
        const skuEls = Array.from(document.querySelectorAll('[data-sku]'));
        const skus = Array.from(new Set(
          skuEls
            .map(el => (el.getAttribute('data-sku') || '').toString().trim())
            .filter(v => /^\\d{5,20}$/.test(v))
        ));

        const items = Array.from(new Set(
          skuEls
            .map(el => el.closest('li') || el.closest('.gl-item') || el)
            .filter(Boolean)
        ));

        const getSku = (item) => {
          const direct = (item.getAttribute('data-sku') || item.getAttribute('data-sku-id') || '').toString();
          if (direct) return direct;
          const nested = item.querySelector && item.querySelector('[data-sku]');
          if (nested) {
            const v = (nested.getAttribute('data-sku') || nested.getAttribute('data-sku-id') || '').toString();
            if (v) return v;
          }
          return '';
        };
        const isSelf = (item) => {
          const venderId = (item.getAttribute('data-venderid') || item.getAttribute('venderid') || '').toString();
          if (venderId === '1000000127') return true;

          const shopNameEl = item.querySelector('.p-shop a') || item.querySelector('.p-shop span');
          const shopName = shopNameEl ? ((shopNameEl.innerText || shopNameEl.textContent || '').toString()) : '';
          if (shopName.includes('京东自营') || shopName.includes('JD.COM自营')) return true;

          const candidates = [
            item.querySelector('.J-picon-tips'),
            item.querySelector('.p-tag .J-picon-tips'),
            item.querySelector('.goods-icons .J-picon-tips'),
            item.querySelector('.goods-icons'),
            item.querySelector('[data-tips*="自营"]'),
            item.querySelector('[title*="自营"]'),
          ].filter(Boolean);
          const text = candidates.map(el => (el.innerText || el.textContent || '')).join(' ');
          const tips = candidates.map(el => (el.getAttribute ? (el.getAttribute('data-tips') || '') : '')).join(' ');
          if ((text + ' ' + tips).includes('自营') || (text + ' ' + tips).includes('京东自营')) return true;

          const all = ((item.innerText || '') + ' ' + (item.textContent || '')).toString();
          if (all.includes('京东自营') || all.includes('自营')) return true;

          return false;
        };

        const selfOperated = items.find(isSelf);
        if (!selfOperated) return { sku: '', candidates: skus.slice(0, 20), sample: items.slice(0, 8).map((it) => {
          const shopNameEl = it.querySelector('.p-shop a') || it.querySelector('.p-shop span');
          const shopName = shopNameEl ? ((shopNameEl.innerText || shopNameEl.textContent || '').toString()) : '';
          const venderId = (it.getAttribute('data-venderid') || it.getAttribute('venderid') || '').toString();
          const sku = getSku(it);
          const text = ((it.innerText || it.textContent || '')).toString().replace(/\\s+/g,' ').slice(0, 120);
          return { sku, venderId, shopName, text };
        }) };

        const sku = getSku(selfOperated);
        if (!sku) return { sku: '', candidates: skus.slice(0, 20), sample: items.slice(0, 8).map((it) => ({ sku: getSku(it) })) };
        return { sku, candidates: skus.slice(0, 20) };
      })()
    `)

    const sku = picked && typeof picked === 'object' ? (picked.sku || '').toString() : ''
    if (picked && typeof picked === 'object' && picked.candidates) debug.skuCandidates = picked.candidates
    if (picked && typeof picked === 'object' && picked.sample) debug.selfSample = picked.sample
    debug.sku = sku
    let finalSku = sku
    if (!finalSku && picked && typeof picked === 'object' && Array.isArray(picked.candidates)) {
      for (const candidate of picked.candidates.slice(0, 8)) {
        const isSelf = await fetchTextViaNet(`https://item.jd.com/${candidate}.html`, 10000)
        const body = isSelf?.body || ''
        if (/venderId\\s*[:=]\\s*1000000127/.test(body) || /"venderId"\\s*:\\s*1000000127/.test(body)) {
          finalSku = candidate
          debug.skuFromItem = candidate
          break
        }
      }
    }

    if (!finalSku) {
      debug.stage = 'no_self'
      console.log('[JD]', JSON.stringify(debug))
      return { noPriceReason: 'no_self', debug }
    }

    // Use JD public price api for realtime price (more stable than DOM)
    const priceApiUrl = `https://p.3.cn/prices/mgets?skuIds=J_${encodeURIComponent(finalSku)}`
    const netRes = await fetchTextViaNet(priceApiUrl, 2500)
    debug.priceApi = {
      url: priceApiUrl,
      statusCode: netRes?.statusCode,
      finalUrl: netRes?.url,
      location: netRes?.location,
      bodySnippet: netRes?.body ? netRes.body.slice(0, 180) : null,
      error: netRes?.error || (!netRes ? 'no_response' : null),
    }

    let bodyText = netRes?.body || null
    if (!bodyText) {
      const pageText = await win.webContents.executeJavaScript(`
        (() => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 3000);
          return fetch(${JSON.stringify(priceApiUrl)}, { credentials: 'include', signal: controller.signal })
            .then(r => r.text())
            .catch(() => '')
            .finally(() => clearTimeout(timer));
        })()
      `)
      const trimmed = typeof pageText === 'string' ? pageText.trim() : ''
      if (trimmed) {
        bodyText = trimmed
        debug.priceApi.pageFetchSnippet = trimmed.slice(0, 180)
      }
    }

    let p = 0
    let op = 0
    if (bodyText) {
      try {
        const priceJson = JSON.parse(bodyText)
        const row = Array.isArray(priceJson) ? priceJson[0] : null
        p = row && row.p ? parseFloat(row.p) : 0
        op = row && row.op ? parseFloat(row.op) : 0
      } catch {
        // ignore, fallback to mobile parsing
      }
    }

    if (!p || !isFinite(p) || p <= 0) {
      const mobileUrl = `https://item.m.jd.com/product/${encodeURIComponent(finalSku)}.html`
      const mobileUa =
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
      const mobileRes = await fetchTextViaNet(mobileUrl, 10000, 3, {
        userAgent: mobileUa,
        referer: `https://item.m.jd.com/product/${encodeURIComponent(finalSku)}.html`,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      })
      const mobileHtml = mobileRes?.body || ''
      const parsed = mobileHtml ? parseJdMobilePrice(mobileHtml) : {}
      debug.mobileFallback = {
        url: mobileUrl,
        statusCode: mobileRes?.statusCode,
        error: mobileRes?.error || (!mobileRes ? 'no_response' : null),
        shopName: parsed.shopName,
        snippet: mobileHtml ? mobileHtml.slice(0, 180) : null,
      }

      const shopName = parsed.shopName || ''
      if (shopName && !shopName.includes('自营')) {
        debug.stage = 'no_self'
        console.log('[JD]', JSON.stringify(debug))
        return { noPriceReason: 'no_self', debug }
      }

      const mp = parsed.price || 0
      const mop = parsed.originalPrice || 0
      if (!mp || !isFinite(mp) || mp <= 0) {
        debug.stage = 'no_price'
        console.log('[JD]', JSON.stringify(debug))
        return { noPriceReason: 'no_price', debug }
      }

      const info: JDPriceInfo = {
        price: mp,
        inStock: true,
        isSelfOperated: true,
        url: `https://item.jd.com/${finalSku}.html`,
        sku: String(finalSku),
      }
      debug.stage = 'ok'
      debug.price = mp
      debug.priceSource = 'mobile_html'
      console.log('[JD]', JSON.stringify(debug))
      return info
    }

    const info: JDPriceInfo = {
      price: p,
      inStock: true,
      isSelfOperated: true,
      url: `https://item.jd.com/${finalSku}.html`,
      sku: String(finalSku),
    }

    debug.stage = 'ok'
    debug.price = p
    debug.priceSource = 'p3cn'
    console.log('[JD]', JSON.stringify(debug))
    return info
  }

  try {
    const result = (await Promise.race([run(), overallTimeout])) as JDFetchResult | null
    if ((result as any)?.debug?.stage === 'overall_timeout') {
      console.log('[JD]', JSON.stringify((result as any).debug))
    }
    return result
  } catch (error: any) {
    const msg = (error?.message || '').toString()
    const code = (error?.code || '').toString()
    const url = (error?.url || '').toString()

    if (code === 'ERR_ABORTED' && url.includes('passport.jd.com/new/login')) {
      throw new Error('JD_LOGIN_REQUIRED')
    }
    if (code === 'ERR_ABORTED' && url.includes('cfe.m.jd.com/privatedomain/risk_handler')) {
      throw new Error('JD_RISK_REQUIRED')
    }

    if (msg.includes('JD_LOGIN_REQUIRED') || msg.includes('JD_RISK_REQUIRED')) {
      throw error
    }

    console.error('JD Scrape error:', error)
    return null
  } finally {
    // Force close
    win.destroy()
  }
}
