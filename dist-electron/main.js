"use strict";
const electron = require("electron");
const path = require("path");
const Database = require("better-sqlite3");
const crypto = require("crypto");
let db;
function initDb() {
  const dbPath = path.join(electron.app.getPath("userData"), "booklist.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      isbn TEXT UNIQUE,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      translator TEXT,
      publisher TEXT,
      list_price DECIMAL(10,2),
      cover_url TEXT,
      description TEXT,
      publish_year INTEGER,
      page_count INTEGER,
      status TEXT CHECK (status IN ('unpurchased', 'reading', 'finished')) DEFAULT 'unpurchased',
      purchase_date DATE,
      start_reading_date DATE,
      finish_reading_date DATE,
      reading_progress INTEGER DEFAULT 0 CHECK (reading_progress >= 0 AND reading_progress <= 100),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_books_status ON books(status);
    CREATE INDEX IF NOT EXISTS idx_books_author ON books(author);

    CREATE TABLE IF NOT EXISTS series (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      author TEXT,
      sort_mode TEXT DEFAULT 'publish_year',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS series_books (
      id TEXT PRIMARY KEY,
      series_id TEXT NOT NULL,
      book_id TEXT NOT NULL,
      order_index INTEGER DEFAULT 0,
      FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
      UNIQUE(series_id, book_id)
    );

    CREATE INDEX IF NOT EXISTS idx_series_books_series ON series_books(series_id);

    CREATE TABLE IF NOT EXISTS price_history (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      original_price DECIMAL(10,2),
      discount_rate DECIMAL(5,2),
      in_stock BOOLEAN DEFAULT true,
      fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_price_history_book ON price_history(book_id);
    CREATE INDEX IF NOT EXISTS idx_price_history_fetched ON price_history(fetched_at DESC);
  `);
  try {
    db.exec("ALTER TABLE books ADD COLUMN translator TEXT");
  } catch (e) {
  }
  try {
    db.exec("ALTER TABLE books ADD COLUMN jd_sku TEXT");
  } catch (e) {
  }
  try {
    db.exec("ALTER TABLE books ADD COLUMN jd_url TEXT");
  } catch (e) {
  }
  try {
    db.exec("ALTER TABLE books ADD COLUMN list_price DECIMAL(10,2)");
  } catch (e) {
  }
  try {
    db.exec("ALTER TABLE series ADD COLUMN author TEXT");
  } catch (e) {
  }
  try {
    db.exec("ALTER TABLE series ADD COLUMN sort_mode TEXT DEFAULT 'publish_year'");
  } catch (e) {
  }
  return db;
}
function getDb() {
  if (!db) {
    throw new Error("Database not initialized");
  }
  return db;
}
async function searchGoogleBooks(query) {
  const q = query.trim();
  if (!q) return [];
  const suggestResults = await searchDoubanSuggest(q);
  if (suggestResults.length >= 3) return suggestResults;
  const htmlResults = await searchDoubanHtml(q);
  const merged = [];
  const seen = /* @__PURE__ */ new Set();
  const pushUnique = (r) => {
    const key = (r.detailUrl || `${r.title}|${r.author}`).toString();
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(r);
  };
  suggestResults.forEach(pushUnique);
  htmlResults.forEach(pushUnique);
  return merged.slice(0, 20);
}
function createHiddenWindow() {
  const win2 = new electron.BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    webPreferences: {
      offscreen: true,
      images: false,
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  win2.webContents.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );
  return win2;
}
async function searchDoubanSuggest(query) {
  const win2 = createHiddenWindow();
  const url = `https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(query)}`;
  try {
    await win2.loadURL(url);
    const text = await win2.webContents.executeJavaScript(`document.body ? document.body.innerText : ''`);
    const data = JSON.parse(text || "[]");
    if (!Array.isArray(data)) return [];
    return data.filter((x) => x && x.title).slice(0, 20).map((x) => {
      const author = (x.author_name || x.author || "").toString().trim();
      const detailUrl = x.url || (x.id ? `https://book.douban.com/subject/${x.id}/` : void 0);
      return {
        title: x.title,
        author: author || "未知作者",
        publisher: x.publisher || void 0,
        publishDate: x.year || void 0,
        coverUrl: x.pic || void 0,
        isbn: void 0,
        detailUrl
      };
    });
  } catch {
    return [];
  } finally {
    win2.destroy();
  }
}
async function searchDoubanHtml(query) {
  const win2 = createHiddenWindow();
  const url = `https://search.douban.com/book/subject_search?search_text=${encodeURIComponent(query)}&cat=1001`;
  try {
    await win2.loadURL(url);
    await win2.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const start = Date.now();
        const timer = setInterval(() => {
          if (document.querySelector('.item-root')) { clearInterval(timer); resolve(true); }
          if (Date.now() - start > 5000) { clearInterval(timer); resolve(false); }
        }, 200);
      })
    `);
    const results = await win2.webContents.executeJavaScript(`
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
    `);
    return Array.isArray(results) ? results : [];
  } catch {
    return [];
  } finally {
    win2.destroy();
  }
}
const JD_PARTITION = "persist:jd";
function getJdPartition() {
  return JD_PARTITION;
}
async function hasJdLogin() {
  const ses = electron.session.fromPartition(JD_PARTITION);
  const cookies = await ses.cookies.get({});
  return cookies.some((c) => {
    if (c.name !== "pt_key" && c.name !== "pt_pin") return false;
    const domain = (c.domain || "").toLowerCase();
    return domain.includes("jd.com") || domain.includes("3.cn");
  });
}
async function openJdAuthWindow(targetUrl, userAgent, mode = "risk") {
  const win2 = new electron.BrowserWindow({
    width: 1100,
    height: 760,
    show: true,
    webPreferences: {
      partition: JD_PARTITION,
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  const url = targetUrl || "https://search.jd.com/Search?keyword=9787111558422&enc=utf-8";
  const mobileUa = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
  const defaultUa = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  const ua = userAgent || (url.includes("item.m.jd.com") ? mobileUa : defaultUa);
  win2.webContents.setUserAgent(ua);
  return await new Promise((resolve) => {
    let resolved = false;
    let sawSafePage = false;
    let lastUrl = "";
    let urlPoll;
    const finish = (ok) => {
      if (resolved) return;
      resolved = true;
      if (urlPoll) clearInterval(urlPoll);
      try {
        win2.destroy();
      } catch {
      }
      resolve(ok);
    };
    const isRiskOrLogin = (u) => u.includes("passport.jd.com/new/login") || u.includes("cfe.m.jd.com/privatedomain/risk_handler");
    const isSafeJdPage = (u) => {
      if (!u) return false;
      if (isRiskOrLogin(u)) return false;
      try {
        const host = new URL(u).hostname.toLowerCase();
        return host.endsWith(".jd.com") || host === "jd.com" || host.endsWith(".3.cn") || host === "3.cn";
      } catch {
        return false;
      }
    };
    const markIfSafe = () => {
      try {
        const current = win2.webContents.getURL() || "";
        lastUrl = current;
        if (isSafeJdPage(current)) sawSafePage = true;
      } catch {
      }
    };
    win2.webContents.on("did-navigate", markIfSafe);
    win2.webContents.on("did-navigate-in-page", markIfSafe);
    win2.webContents.on("did-frame-finish-load", markIfSafe);
    urlPoll = setInterval(markIfSafe, 300);
    const poll = setInterval(async () => {
      try {
        markIfSafe();
        if (!sawSafePage) return;
        const ok = await hasJdLogin();
        if (!ok) return;
        clearInterval(poll);
        finish(true);
      } catch {
      }
    }, 1e3);
    win2.loadURL(url).then(() => {
      markIfSafe();
    }).catch(() => {
    });
    win2.on("closed", async () => {
      clearInterval(poll);
      try {
        const safe = sawSafePage || isSafeJdPage(lastUrl);
        if (mode === "risk") {
          finish(safe || await hasJdLogin());
          return;
        }
        finish(safe && await hasJdLogin() || await hasJdLogin());
      } catch {
        finish(false);
      }
    });
  });
}
async function fetchTextViaNet(url, timeoutMs, redirectLeft = 3, headers = {}) {
  const ses = electron.session.fromPartition(getJdPartition());
  return await new Promise((resolve) => {
    const req = electron.net.request({ url, session: ses });
    req.setHeader(
      "User-Agent",
      headers.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    req.setHeader("Accept", headers.accept || "application/json,text/plain,*/*");
    req.setHeader("Referer", headers.referer || "https://item.jd.com/");
    const timer = setTimeout(() => {
      try {
        req.abort();
      } catch {
      }
      resolve({ url, body: null, error: "timeout" });
    }, timeoutMs);
    req.on("response", (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on("end", () => {
        var _a, _b;
        clearTimeout(timer);
        const statusCode = res.statusCode || 0;
        const locationHeader = ((_a = res.headers) == null ? void 0 : _a.location) || ((_b = res.headers) == null ? void 0 : _b.Location);
        const location = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader;
        if (statusCode >= 300 && statusCode < 400 && location && redirectLeft > 0) {
          const nextUrl = location.startsWith("http") ? location : new URL(location, url).toString();
          fetchTextViaNet(nextUrl, timeoutMs, redirectLeft - 1, headers).then(resolve).catch(() => resolve(null));
          return;
        }
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({ statusCode, url, body: statusCode >= 200 && statusCode < 300 ? body : null, location });
      });
    });
    req.on("error", () => {
      clearTimeout(timer);
      resolve({ url, body: null, error: "error" });
    });
    req.end();
  });
}
function parseJdMobilePrice(html) {
  const shopMatch = html.match(/"shopName"\s*:\s*"([^"]+)"/);
  const shopName = shopMatch ? shopMatch[1] : void 0;
  const priceMatch = html.match(/"jdprice_amount"\s*:\s*"([\d.]+)"/) || html.match(/"jdPrice"\s*:\s*"([\d.]+)"/);
  const price = priceMatch ? parseFloat(priceMatch[1]) : void 0;
  const originalMatch = html.match(/"salePrice"\s*:\s*"([\d.]+)"/) || html.match(/"originPrice"\s*:\s*"([\d.]+)"/) || html.match(/"ORIGINAL"\s*:\s*\{[^}]*"salePrice"\s*:\s*"([\d.]+)"/);
  originalMatch ? parseFloat(originalMatch[1]) : void 0;
  return {
    price: price && isFinite(price) ? price : void 0,
    originalPrice: void 0,
    shopName
  };
}
function parseSkuFromAny(input) {
  const s = (input || "").toString();
  const m = s.match(/item\.jd\.com\/(\d{5,20})\.html/i) || s.match(/product\/(\d{5,20})\.html/i) || s.match(/[?&]skuId=(\d{5,20})/i) || s.match(/\b(\d{5,20})\b/);
  return m ? m[1] : null;
}
async function fetchJdPriceBySku(skuOrUrl) {
  const sku = parseSkuFromAny(skuOrUrl);
  if (!sku) return null;
  const debug = { sku, stage: "init_sku" };
  try {
    const pc = await fetchJdPriceBySkuViaPcWindowInternal(sku, false);
    if (pc && !pc.noPriceReason) {
      debug.stage = "ok";
      debug.price = pc.price;
      debug.priceSource = "pc_dom";
      console.log("[JD]", JSON.stringify(debug));
      return pc;
    }
  } catch (e) {
    if (((e == null ? void 0 : e.message) || "").includes("JD_LOGIN_REQUIRED") || ((e == null ? void 0 : e.message) || "").includes("JD_RISK_REQUIRED")) {
      throw e;
    }
  }
  const priceApiUrl = `https://p.3.cn/prices/mgets?skuIds=J_${encodeURIComponent(sku)}`;
  const netRes = await fetchTextViaNet(priceApiUrl, 2500);
  debug.priceApi = {
    url: priceApiUrl,
    statusCode: netRes == null ? void 0 : netRes.statusCode,
    finalUrl: netRes == null ? void 0 : netRes.url,
    location: netRes == null ? void 0 : netRes.location,
    bodySnippet: (netRes == null ? void 0 : netRes.body) ? netRes.body.slice(0, 180) : null,
    error: (netRes == null ? void 0 : netRes.error) || (!netRes ? "no_response" : null)
  };
  let p = 0;
  let op = 0;
  if (netRes == null ? void 0 : netRes.body) {
    try {
      const priceJson = JSON.parse(netRes.body);
      const row = Array.isArray(priceJson) ? priceJson[0] : null;
      p = row && row.p ? parseFloat(row.p) : 0;
      op = row && row.op ? parseFloat(row.op) : 0;
    } catch {
    }
  }
  if (p && isFinite(p) && p > 0) {
    const info2 = {
      price: p,
      inStock: true,
      isSelfOperated: true,
      url: `https://item.jd.com/${sku}.html`,
      sku
    };
    debug.stage = "ok";
    debug.price = p;
    debug.priceSource = "p3cn";
    console.log("[JD]", JSON.stringify(debug));
    return info2;
  }
  const mobileUa = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
  const mobileUrl = `https://item.m.jd.com/product/${encodeURIComponent(sku)}.html`;
  const mobileRes = await fetchTextViaNet(mobileUrl, 1e4, 3, {
    userAgent: mobileUa,
    referer: mobileUrl,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
  });
  const mobileHtml = (mobileRes == null ? void 0 : mobileRes.body) || "";
  const parsed = mobileHtml ? parseJdMobilePrice(mobileHtml) : {};
  debug.mobileFallback = {
    url: mobileUrl,
    statusCode: mobileRes == null ? void 0 : mobileRes.statusCode,
    error: (mobileRes == null ? void 0 : mobileRes.error) || (!mobileRes ? "no_response" : null),
    shopName: parsed.shopName,
    snippet: mobileHtml ? mobileHtml.slice(0, 180) : null
  };
  const isSelf = mobileHtml.includes("自营") || (parsed.shopName || "").includes("自营");
  if (!isSelf) {
    const winRes = await fetchJdPriceBySkuViaMobileWindow(sku);
    if (winRes && !winRes.noPriceReason) {
      debug.stage = "ok";
      debug.price = winRes.price;
      debug.priceSource = "mobile_dom";
      console.log("[JD]", JSON.stringify(debug));
      return winRes;
    }
    debug.stage = "no_self";
    console.log("[JD]", JSON.stringify(debug));
    return { noPriceReason: "no_self", debug };
  }
  const mp = parsed.price || 0;
  if (!mp || !isFinite(mp) || mp <= 0) {
    debug.stage = "no_price";
    console.log("[JD]", JSON.stringify(debug));
    return { noPriceReason: "no_price", debug };
  }
  const info = {
    price: mp,
    inStock: true,
    isSelfOperated: true,
    url: `https://item.jd.com/${sku}.html`,
    sku
  };
  debug.stage = "ok";
  debug.price = mp;
  debug.priceSource = "mobile_html";
  console.log("[JD]", JSON.stringify(debug));
  return info;
}
async function fetchJdPriceBySkuViaMobileWindow(sku) {
  const mobileUa = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
  const mobileUrl = `https://item.m.jd.com/product/${encodeURIComponent(sku)}.html`;
  const win2 = new electron.BrowserWindow({
    width: 420,
    height: 860,
    show: false,
    webPreferences: {
      offscreen: true,
      images: false,
      partition: getJdPartition()
    }
  });
  try {
    win2.webContents.setUserAgent(mobileUa);
    await loadUrlWithTimeout(win2, mobileUrl, 15e3);
    const finalUrl = win2.webContents.getURL();
    if (finalUrl.includes("passport.jd.com/new/login")) throw new Error("JD_LOGIN_REQUIRED");
    if (finalUrl.includes("cfe.m.jd.com/privatedomain/risk_handler")) throw new Error("JD_RISK_REQUIRED");
    const extracted = await win2.webContents.executeJavaScript(`
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
    `);
    const price = (extracted == null ? void 0 : extracted.price) ? Number(extracted.price) : 0;
    const shopText = ((extracted == null ? void 0 : extracted.shopText) || "").toString();
    if (!price || !isFinite(price) || price <= 0) {
      return { noPriceReason: "no_price" };
    }
    const isSelf = shopText.includes("自营");
    if (!isSelf) return { noPriceReason: "no_self" };
    const info = {
      price,
      inStock: true,
      isSelfOperated: true,
      url: `https://item.jd.com/${sku}.html`,
      sku
    };
    return info;
  } finally {
    win2.destroy();
  }
}
async function fetchJdPriceBySkuInteractive(skuOrUrl) {
  const sku = parseSkuFromAny(skuOrUrl);
  if (!sku) return null;
  return fetchJdPriceBySkuViaPcWindowInternal(sku, true);
}
async function fetchJdPriceBySkuViaPcWindowInternal(sku, interactive) {
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  const url = `https://item.jd.com/${encodeURIComponent(sku)}.html`;
  const win2 = new electron.BrowserWindow({
    width: 1100,
    height: 760,
    show: interactive,
    webPreferences: {
      partition: getJdPartition()
    }
  });
  try {
    win2.webContents.setUserAgent(ua);
    console.log("[JD]", JSON.stringify({ sku, stage: interactive ? "pc_interactive_open" : "pc_hidden_open", url }));
    try {
      await loadUrlWithTimeout(win2, url, 2e4);
    } catch {
      if (!interactive) throw new Error("JD_RISK_REQUIRED");
    }
    const maxWaitMs = interactive ? 18e4 : 12e3;
    const start = Date.now();
    const extractOnce = async () => {
      try {
        const currentUrl = win2.webContents.getURL() || "";
        const data = await win2.webContents.executeJavaScript(`
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
        `);
        return {
          url: currentUrl,
          price: (data == null ? void 0 : data.price) ? Number(data.price) : 0,
          shopText: ((data == null ? void 0 : data.shopText) || "").toString()
        };
      } catch {
        return { url: "", price: 0, shopText: "" };
      }
    };
    const result = await new Promise((resolve) => {
      let lastUrl = "";
      const timer = setInterval(async () => {
        if (win2.isDestroyed()) {
          clearInterval(timer);
          resolve({ price: 0, shopText: "", lastUrl });
          return;
        }
        const snapshot = await extractOnce();
        if (snapshot.url) lastUrl = snapshot.url;
        if (snapshot.price > 0 && isFinite(snapshot.price)) {
          clearInterval(timer);
          resolve({ price: snapshot.price, shopText: snapshot.shopText, lastUrl });
          return;
        }
        if (Date.now() - start > maxWaitMs) {
          clearInterval(timer);
          resolve({ price: 0, shopText: snapshot.shopText, lastUrl });
        }
      }, 600);
      win2.on("closed", () => {
        clearInterval(timer);
        resolve({ price: 0, shopText: "", lastUrl });
      });
    });
    if (result.price <= 0) {
      console.log("[JD]", JSON.stringify({ sku, stage: interactive ? "pc_interactive_no_price" : "pc_hidden_no_price", lastUrl: result.lastUrl }));
      return { noPriceReason: "no_price" };
    }
    const info = {
      price: result.price,
      inStock: true,
      isSelfOperated: true,
      url,
      sku
    };
    console.log("[JD]", JSON.stringify({ sku, stage: interactive ? "pc_interactive_ok" : "pc_hidden_ok", price: result.price, lastUrl: result.lastUrl }));
    return info;
  } finally {
    if (!win2.isDestroyed()) win2.destroy();
  }
}
async function loadUrlWithTimeout(win2, url, timeoutMs) {
  const timeoutError = Object.assign(new Error("JD_LOAD_TIMEOUT"), { url });
  await Promise.race([
    win2.loadURL(url),
    new Promise((_, reject) => {
      const t = setTimeout(() => {
        try {
          win2.webContents.stop();
        } catch {
        }
        reject(timeoutError);
      }, timeoutMs);
      win2.webContents.once("did-finish-load", () => clearTimeout(t));
      win2.webContents.once("did-fail-load", () => clearTimeout(t));
      win2.webContents.once("destroyed", () => clearTimeout(t));
    })
  ]);
}
async function fetchJdPrice(isbn) {
  var _a;
  const trimmed = (isbn || "").trim();
  if (!trimmed) return null;
  const debug = { isbn: trimmed, stage: "init" };
  const overallTimeoutMs = 45e3;
  const win2 = new electron.BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    // Hidden window
    webPreferences: {
      offscreen: true,
      images: false,
      // Disable images for speed
      partition: getJdPartition()
    }
  });
  const overallTimeout = new Promise((resolve) => {
    setTimeout(
      () => resolve({ noPriceReason: "no_price", debug: { ...debug, stage: "overall_timeout" } }),
      overallTimeoutMs
    );
  });
  const run = async () => {
    var _a2, _b;
    win2.webContents.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    const searchUrl = `https://search.jd.com/Search?keyword=${encodeURIComponent(trimmed)}&enc=utf-8`;
    try {
      debug.stage = "load_search";
      console.log("[JD]", JSON.stringify({ ...debug, msg: "load search start" }));
      await loadUrlWithTimeout(win2, searchUrl, 15e3);
    } catch (e) {
      const url = typeof (e == null ? void 0 : e.url) === "string" ? e.url : "";
      if (url.includes("passport.jd.com/new/login")) {
        throw new Error("JD_LOGIN_REQUIRED");
      }
      if (url.includes("cfe.m.jd.com/privatedomain/risk_handler")) {
        throw new Error("JD_RISK_REQUIRED");
      }
      if (((e == null ? void 0 : e.message) || "").toString().includes("JD_LOAD_TIMEOUT")) {
        console.log("[JD]", JSON.stringify({ ...debug, stage: "load_search_timeout", url: searchUrl }));
        return null;
      }
      throw e;
    }
    const finalUrl = win2.webContents.getURL();
    debug.searchUrl = searchUrl;
    debug.searchFinalUrl = finalUrl;
    if (finalUrl.includes("passport.jd.com/new/login")) {
      throw new Error("JD_LOGIN_REQUIRED");
    }
    if (finalUrl.includes("cfe.m.jd.com/privatedomain/risk_handler")) {
      throw new Error("JD_RISK_REQUIRED");
    }
    const hasResults = await win2.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const start = Date.now();
        const timer = setInterval(() => {
          if (document.querySelector('li[data-sku]') || document.querySelector('[data-sku]') || document.querySelector('.gl-item')) { clearInterval(timer); resolve(true); }
          if (Date.now() - start > 6000) { clearInterval(timer); resolve(false); }
        }, 200);
      })
    `);
    if (!hasResults) {
      debug.stage = "no_results";
      debug.page = await win2.webContents.executeJavaScript(`
        (() => {
          const title = (document.title || '').toString().slice(0, 120);
          const text = (document.body ? (document.body.innerText || '') : '').toString().replace(/\\s+/g, ' ').slice(0, 220);
          const skuCount = document.querySelectorAll('li[data-sku]').length;
          const anySkuCount = document.querySelectorAll('[data-sku]').length;
          return { title, text, skuCount, anySkuCount };
        })()
      `);
      const title = (((_a2 = debug.page) == null ? void 0 : _a2.title) || "").toString();
      const text = (((_b = debug.page) == null ? void 0 : _b.text) || "").toString();
      if (title.includes("商品搜索") && (text.includes("访问频繁") || text.includes("无法搜索") || text.includes("请稍后再试"))) {
        debug.blocked = "search_rate_limited";
      }
      console.log("[JD]", JSON.stringify(debug));
      return { noPriceReason: "no_price", debug };
    }
    const picked = await win2.webContents.executeJavaScript(`
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
    `);
    const sku = picked && typeof picked === "object" ? (picked.sku || "").toString() : "";
    if (picked && typeof picked === "object" && picked.candidates) debug.skuCandidates = picked.candidates;
    if (picked && typeof picked === "object" && picked.sample) debug.selfSample = picked.sample;
    debug.sku = sku;
    let finalSku = sku;
    if (!finalSku && picked && typeof picked === "object" && Array.isArray(picked.candidates)) {
      for (const candidate of picked.candidates.slice(0, 8)) {
        const isSelf = await fetchTextViaNet(`https://item.jd.com/${candidate}.html`, 1e4);
        const body = (isSelf == null ? void 0 : isSelf.body) || "";
        if (/venderId\\s*[:=]\\s*1000000127/.test(body) || /"venderId"\\s*:\\s*1000000127/.test(body)) {
          finalSku = candidate;
          debug.skuFromItem = candidate;
          break;
        }
      }
    }
    if (!finalSku) {
      debug.stage = "no_self";
      console.log("[JD]", JSON.stringify(debug));
      return { noPriceReason: "no_self", debug };
    }
    const priceApiUrl = `https://p.3.cn/prices/mgets?skuIds=J_${encodeURIComponent(finalSku)}`;
    const netRes = await fetchTextViaNet(priceApiUrl, 2500);
    debug.priceApi = {
      url: priceApiUrl,
      statusCode: netRes == null ? void 0 : netRes.statusCode,
      finalUrl: netRes == null ? void 0 : netRes.url,
      location: netRes == null ? void 0 : netRes.location,
      bodySnippet: (netRes == null ? void 0 : netRes.body) ? netRes.body.slice(0, 180) : null,
      error: (netRes == null ? void 0 : netRes.error) || (!netRes ? "no_response" : null)
    };
    let bodyText = (netRes == null ? void 0 : netRes.body) || null;
    if (!bodyText) {
      const pageText = await win2.webContents.executeJavaScript(`
        (() => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 3000);
          return fetch(${JSON.stringify(priceApiUrl)}, { credentials: 'include', signal: controller.signal })
            .then(r => r.text())
            .catch(() => '')
            .finally(() => clearTimeout(timer));
        })()
      `);
      const trimmed2 = typeof pageText === "string" ? pageText.trim() : "";
      if (trimmed2) {
        bodyText = trimmed2;
        debug.priceApi.pageFetchSnippet = trimmed2.slice(0, 180);
      }
    }
    let p = 0;
    let op = 0;
    if (bodyText) {
      try {
        const priceJson = JSON.parse(bodyText);
        const row = Array.isArray(priceJson) ? priceJson[0] : null;
        p = row && row.p ? parseFloat(row.p) : 0;
        op = row && row.op ? parseFloat(row.op) : 0;
      } catch {
      }
    }
    if (!p || !isFinite(p) || p <= 0) {
      const mobileUrl = `https://item.m.jd.com/product/${encodeURIComponent(finalSku)}.html`;
      const mobileUa = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
      const mobileRes = await fetchTextViaNet(mobileUrl, 1e4, 3, {
        userAgent: mobileUa,
        referer: `https://item.m.jd.com/product/${encodeURIComponent(finalSku)}.html`,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      });
      const mobileHtml = (mobileRes == null ? void 0 : mobileRes.body) || "";
      const parsed = mobileHtml ? parseJdMobilePrice(mobileHtml) : {};
      debug.mobileFallback = {
        url: mobileUrl,
        statusCode: mobileRes == null ? void 0 : mobileRes.statusCode,
        error: (mobileRes == null ? void 0 : mobileRes.error) || (!mobileRes ? "no_response" : null),
        shopName: parsed.shopName,
        snippet: mobileHtml ? mobileHtml.slice(0, 180) : null
      };
      const shopName = parsed.shopName || "";
      if (shopName && !shopName.includes("自营")) {
        debug.stage = "no_self";
        console.log("[JD]", JSON.stringify(debug));
        return { noPriceReason: "no_self", debug };
      }
      const mp = parsed.price || 0;
      if (!mp || !isFinite(mp) || mp <= 0) {
        debug.stage = "no_price";
        console.log("[JD]", JSON.stringify(debug));
        return { noPriceReason: "no_price", debug };
      }
      const info2 = {
        price: mp,
        inStock: true,
        isSelfOperated: true,
        url: `https://item.jd.com/${finalSku}.html`,
        sku: String(finalSku)
      };
      debug.stage = "ok";
      debug.price = mp;
      debug.priceSource = "mobile_html";
      console.log("[JD]", JSON.stringify(debug));
      return info2;
    }
    const info = {
      price: p,
      inStock: true,
      isSelfOperated: true,
      url: `https://item.jd.com/${finalSku}.html`,
      sku: String(finalSku)
    };
    debug.stage = "ok";
    debug.price = p;
    debug.priceSource = "p3cn";
    console.log("[JD]", JSON.stringify(debug));
    return info;
  };
  try {
    const result = await Promise.race([run(), overallTimeout]);
    if (((_a = result == null ? void 0 : result.debug) == null ? void 0 : _a.stage) === "overall_timeout") {
      console.log("[JD]", JSON.stringify(result.debug));
    }
    return result;
  } catch (error) {
    const msg = ((error == null ? void 0 : error.message) || "").toString();
    const code = ((error == null ? void 0 : error.code) || "").toString();
    const url = ((error == null ? void 0 : error.url) || "").toString();
    if (code === "ERR_ABORTED" && url.includes("passport.jd.com/new/login")) {
      throw new Error("JD_LOGIN_REQUIRED");
    }
    if (code === "ERR_ABORTED" && url.includes("cfe.m.jd.com/privatedomain/risk_handler")) {
      throw new Error("JD_RISK_REQUIRED");
    }
    if (msg.includes("JD_LOGIN_REQUIRED") || msg.includes("JD_RISK_REQUIRED")) {
      throw error;
    }
    console.error("JD Scrape error:", error);
    return null;
  } finally {
    win2.destroy();
  }
}
async function fetchDoubanSubjectDetails(detailUrl) {
  if (!detailUrl) return {};
  const win2 = new electron.BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    webPreferences: {
      offscreen: true,
      images: false,
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  win2.webContents.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );
  try {
    await win2.loadURL(detailUrl);
    await win2.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const start = Date.now();
        const timer = setInterval(() => {
          if (document.querySelector('#info')) { clearInterval(timer); resolve(true); }
          if (Date.now() - start > 6000) { clearInterval(timer); resolve(false); }
        }, 200);
      })
    `);
    const infoText = await win2.webContents.executeJavaScript(`(document.querySelector('#info')?.innerText || '').toString()`);
    const details = {};
    if (typeof infoText === "string" && infoText.trim()) {
      const isbnMatch = infoText.match(/ISBN[:：]\s*([\d-]+)/i);
      if (isbnMatch == null ? void 0 : isbnMatch[1]) details.isbn = isbnMatch[1].replace(/-/g, "");
      const publisherMatch = infoText.match(/出版社[:：]\s*([^\n\r]+)/);
      if (publisherMatch == null ? void 0 : publisherMatch[1]) details.publisher = publisherMatch[1].trim();
      const translatorMatch = infoText.match(/译者[:：]\s*([^\n\r]+)/);
      if (translatorMatch == null ? void 0 : translatorMatch[1]) details.translator = translatorMatch[1].trim();
      const priceMatch = infoText.match(/定价[:：]\s*([^\n\r]+)/);
      if (priceMatch == null ? void 0 : priceMatch[1]) {
        const raw = priceMatch[1].trim();
        const m = raw.match(/(\d+(?:\.\d{1,2})?)/);
        if (m == null ? void 0 : m[1]) {
          const n = parseFloat(m[1]);
          if (isFinite(n) && n > 0) details.listPrice = n;
        }
      }
    }
    return details;
  } catch {
    return {};
  } finally {
    win2.destroy();
  }
}
function setupIpc() {
  const db2 = getDb();
  electron.ipcMain.handle("get-books", (event, { status, limit, offset } = {}) => {
    let query = "SELECT * FROM books";
    const params = [];
    if (status) {
      query += " WHERE status = ?";
      params.push(status);
    }
    query += " ORDER BY created_at DESC";
    if (limit) {
      query += " LIMIT ?";
      params.push(limit);
      if (offset) {
        query += " OFFSET ?";
        params.push(offset);
      }
    }
    return db2.prepare(query).all(...params);
  });
  electron.ipcMain.handle("get-book", (event, id) => {
    return db2.prepare("SELECT * FROM books WHERE id = ?").get(id);
  });
  electron.ipcMain.handle("add-book", async (event, book) => {
    const bookData = { ...book };
    if (typeof bookData.isbn === "string" && bookData.isbn.trim() === "") {
      bookData.isbn = null;
    }
    if ((!bookData.isbn || !bookData.publisher || !bookData.translator) && typeof bookData.detailUrl === "string" && bookData.detailUrl) {
      const details = await fetchDoubanSubjectDetails(bookData.detailUrl);
      if (!bookData.isbn && details.isbn) bookData.isbn = details.isbn;
      if (!bookData.publisher && details.publisher) bookData.publisher = details.publisher;
      if (!bookData.translator && details.translator) bookData.translator = details.translator;
      if (!bookData.list_price && details.listPrice) bookData.list_price = details.listPrice;
    }
    if (bookData.isbn) {
      const existing = db2.prepare("SELECT id FROM books WHERE isbn = ?").get(bookData.isbn);
      if (existing == null ? void 0 : existing.id) return { id: existing.id, isExisting: true };
    } else {
      if (bookData.isbn === "") {
        bookData.isbn = null;
      }
    }
    const id = crypto.randomUUID();
    const stmt = db2.prepare(`
      INSERT INTO books (id, isbn, title, author, translator, publisher, list_price, cover_url, description, publish_year, page_count, status)
      VALUES (@id, @isbn, @title, @author, @translator, @publisher, @list_price, @cover_url, @description, @publish_year, @page_count, @status)
    `);
    const safeIsbn = bookData.isbn || null;
    const newBook = { ...bookData, id, isbn: safeIsbn, status: bookData.status || "unpurchased" };
    try {
      stmt.run(newBook);
      return newBook;
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        const existing = db2.prepare("SELECT * FROM books WHERE isbn = ?").get(safeIsbn);
        if (existing && typeof existing === "object") {
          return { ...existing, isExisting: true };
        }
      }
      throw error;
    }
  });
  electron.ipcMain.handle("update-book", (event, book) => {
    const { id, ...rest } = book;
    if (!id) throw new Error("ID is required for update");
    const keys = Object.keys(rest);
    if (keys.length === 0) return book;
    const setClause = keys.map((key) => `${key} = @${key}`).join(", ");
    const stmt = db2.prepare(`UPDATE books SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`);
    stmt.run({ ...book });
    return db2.prepare("SELECT * FROM books WHERE id = ?").get(id);
  });
  electron.ipcMain.handle("delete-book", (event, id) => {
    db2.prepare("DELETE FROM books WHERE id = ?").run(id);
    return id;
  });
  electron.ipcMain.handle("get-series", () => {
    return db2.prepare("SELECT id, name, author, sort_mode, created_at FROM series ORDER BY created_at DESC").all();
  });
  electron.ipcMain.handle("add-series", (event, { name, author }) => {
    const id = crypto.randomUUID();
    db2.prepare("INSERT INTO series (id, name, author) VALUES (?, ?, ?)").run(id, name, author || null);
    return db2.prepare("SELECT id, name, author, sort_mode, created_at FROM series WHERE id = ?").get(id);
  });
  electron.ipcMain.handle("update-series", (event, { id, name, author }) => {
    const series = db2.prepare("SELECT id FROM series WHERE id = ?").get(id);
    if (!series) throw new Error("SERIES_NOT_FOUND");
    const n = (name || "").toString().trim();
    if (!n) throw new Error("SERIES_NAME_REQUIRED");
    const a = author === void 0 || author === null ? null : (author || "").toString().trim() || null;
    db2.prepare("UPDATE series SET name = ?, author = ? WHERE id = ?").run(n, a, id);
    return db2.prepare("SELECT id, name, author, sort_mode, created_at FROM series WHERE id = ?").get(id);
  });
  electron.ipcMain.handle("get-series-with-books", () => {
    const seriesList = db2.prepare("SELECT id, name, author, sort_mode, created_at FROM series ORDER BY created_at DESC").all();
    const getBooksForSeries = (s) => {
      const sortMode = (s.sort_mode || "publish_year").toString();
      const orderClause = sortMode === "manual" ? "ORDER BY COALESCE(sb.order_index, 999999) ASC, b.created_at ASC" : "ORDER BY COALESCE(b.publish_year, 999999) ASC, b.created_at ASC";
      return db2.prepare(
        `
          SELECT b.*
          FROM series_books sb
          JOIN books b ON b.id = sb.book_id
          WHERE sb.series_id = ?
          ${orderClause}
        `
      ).all(s.id);
    };
    return seriesList.map((s) => ({ ...s, books: getBooksForSeries(s) }));
  });
  electron.ipcMain.handle("add-book-to-series", (event, { seriesId, bookId }) => {
    const series = db2.prepare("SELECT id, sort_mode FROM series WHERE id = ?").get(seriesId);
    if (!series) throw new Error("SERIES_NOT_FOUND");
    const id = crypto.randomUUID();
    let orderIndex = null;
    if ((series.sort_mode || "publish_year") === "manual") {
      const row = db2.prepare("SELECT MAX(order_index) as maxOrder FROM series_books WHERE series_id = ?").get(seriesId);
      const maxOrder = (row == null ? void 0 : row.maxOrder) === null || (row == null ? void 0 : row.maxOrder) === void 0 ? 0 : Number(row.maxOrder);
      orderIndex = Number.isFinite(maxOrder) ? maxOrder + 1 : 1;
    }
    db2.prepare("INSERT OR IGNORE INTO series_books (id, series_id, book_id, order_index) VALUES (?, ?, ?, ?)").run(
      id,
      seriesId,
      bookId,
      orderIndex
    );
    return true;
  });
  electron.ipcMain.handle("remove-book-from-series", (event, { seriesId, bookId }) => {
    db2.prepare("DELETE FROM series_books WHERE series_id = ? AND book_id = ?").run(seriesId, bookId);
    return true;
  });
  electron.ipcMain.handle("reorder-series-books", (event, { seriesId, orderedBookIds }) => {
    if (!Array.isArray(orderedBookIds)) throw new Error("INVALID_ORDER");
    const tx = db2.transaction(() => {
      db2.prepare("UPDATE series SET sort_mode = 'manual' WHERE id = ?").run(seriesId);
      const stmt = db2.prepare("UPDATE series_books SET order_index = ? WHERE series_id = ? AND book_id = ?");
      orderedBookIds.forEach((bookId, idx) => {
        stmt.run(idx + 1, seriesId, bookId);
      });
    });
    tx();
    return true;
  });
  electron.ipcMain.handle("add-price-history", (event, history) => {
    const id = crypto.randomUUID();
    const stmt = db2.prepare(`
      INSERT INTO price_history (id, book_id, price, original_price, discount_rate, in_stock)
      VALUES (@id, @book_id, @price, @original_price, @discount_rate, @in_stock)
    `);
    const price = Number(history == null ? void 0 : history.price);
    const original = (history == null ? void 0 : history.original_price) === null || (history == null ? void 0 : history.original_price) === void 0 ? null : Number(history.original_price);
    const discount = Number((history == null ? void 0 : history.discount_rate) ?? 0);
    const inStock = (history == null ? void 0 : history.in_stock) ? 1 : 0;
    const normalized = {
      id,
      book_id: String((history == null ? void 0 : history.book_id) || ""),
      price: Number.isFinite(price) ? price : 0,
      original_price: original !== null && Number.isFinite(original) ? original : null,
      discount_rate: Number.isFinite(discount) ? discount : 0,
      in_stock: inStock
    };
    stmt.run(normalized);
    return normalized;
  });
  electron.ipcMain.handle("get-latest-prices", (event, bookIds) => {
    if (!bookIds || bookIds.length === 0) return [];
    const placeholders = bookIds.map(() => "?").join(",");
    return db2.prepare(`
       SELECT ph.* 
       FROM price_history ph
       INNER JOIN (
         SELECT book_id, MAX(fetched_at) as max_date
         FROM price_history
         WHERE book_id IN (${placeholders})
         GROUP BY book_id
       ) latest ON ph.book_id = latest.book_id AND ph.fetched_at = latest.max_date
     `).all(...bookIds);
  });
  electron.ipcMain.handle("search-books", async (event, query) => {
    return searchGoogleBooks(query);
  });
  electron.ipcMain.handle("fetch-douban-details", async (event, detailUrl) => {
    return fetchDoubanSubjectDetails(detailUrl);
  });
  electron.ipcMain.handle("fetch-jd-price", async (event, isbn) => {
    try {
      return await fetchJdPrice(isbn);
    } catch (e) {
      if (((e == null ? void 0 : e.message) || "").includes("JD_LOGIN_REQUIRED")) {
        return { authRequired: true, reason: "login" };
      }
      if (((e == null ? void 0 : e.message) || "").includes("JD_RISK_REQUIRED")) {
        return { authRequired: true, reason: "risk" };
      }
      throw e;
    }
  });
  electron.ipcMain.handle("fetch-jd-price-by-sku", async (event, payload) => {
    try {
      const skuOrUrl = payload && typeof payload === "object" ? payload.skuOrUrl : payload;
      const interactive = !!(payload && typeof payload === "object" && payload.interactive);
      return await (interactive ? fetchJdPriceBySkuInteractive(skuOrUrl) : fetchJdPriceBySku(skuOrUrl));
    } catch (e) {
      if (((e == null ? void 0 : e.message) || "").includes("JD_LOGIN_REQUIRED")) {
        return { authRequired: true, reason: "login" };
      }
      if (((e == null ? void 0 : e.message) || "").includes("JD_RISK_REQUIRED")) {
        return { authRequired: true, reason: "risk" };
      }
      throw e;
    }
  });
  electron.ipcMain.handle("jd-auth", async (event, payload) => {
    if (payload && typeof payload === "object") {
      return openJdAuthWindow(payload.targetUrl, payload.userAgent, payload.mode);
    }
    return openJdAuthWindow(payload);
  });
}
process.env.DIST = path.join(__dirname, "../dist");
process.env.VITE_PUBLIC = electron.app.isPackaged ? process.env.DIST : path.join(__dirname, "../public");
electron.app.commandLine.appendSwitch("log-level", "3");
let win;
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
function createWindow() {
  win = new electron.BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "../dist-electron/preload.js"),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  win.webContents.on("did-finish-load", () => {
    win == null ? void 0 : win.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  });
  win.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ["https://*.doubanio.com/*", "https://*.douban.com/*"] },
    (details, callback) => {
      details.requestHeaders["Referer"] = "https://book.douban.com/";
      callback({ requestHeaders: details.requestHeaders });
    }
  );
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(process.env.DIST, "index.html"));
  }
}
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
    win = null;
  }
});
electron.app.on("activate", () => {
  if (electron.BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
electron.app.whenReady().then(() => {
  initDb();
  setupIpc();
  createWindow();
});
