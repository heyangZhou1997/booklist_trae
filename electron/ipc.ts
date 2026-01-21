import { ipcMain } from 'electron'
import { getDb } from './db'
import { randomUUID } from 'crypto'
import { searchGoogleBooks } from './services/bookSearch'
import { fetchJdPrice, fetchJdPriceBySku, fetchJdPriceBySkuInteractive } from './services/jdScraper'
import { fetchDoubanSubjectDetails } from './services/doubanDetails'
import { openJdAuthWindow } from './services/jdAuth'

export function setupIpc() {
  const db = getDb()

  // --- Books ---
  ipcMain.handle('get-books', (event, { status, limit, offset } = {}) => {
    let query = 'SELECT * FROM books'
    const params: any[] = []
    
    if (status) {
      query += ' WHERE status = ?'
      params.push(status)
    }
    
    query += ' ORDER BY created_at DESC'
    
    if (limit) {
      query += ' LIMIT ?'
      params.push(limit)
      if (offset) {
        query += ' OFFSET ?'
        params.push(offset)
      }
    }
    
    return db.prepare(query).all(...params)
  })

  ipcMain.handle('get-book', (event, id) => {
    return db.prepare('SELECT * FROM books WHERE id = ?').get(id)
  })

  ipcMain.handle('add-book', async (event, book) => {
    const bookData: any = { ...book }

    if (typeof bookData.isbn === 'string' && bookData.isbn.trim() === '') {
      bookData.isbn = null
    }

    if (
      (!bookData.isbn || !bookData.publisher || !bookData.translator) &&
      typeof bookData.detailUrl === 'string' &&
      bookData.detailUrl
    ) {
      const details = await fetchDoubanSubjectDetails(bookData.detailUrl)
      if (!bookData.isbn && details.isbn) bookData.isbn = details.isbn
      if (!bookData.publisher && details.publisher) bookData.publisher = details.publisher
      if (!bookData.translator && details.translator) bookData.translator = details.translator
      if (!bookData.list_price && details.listPrice) bookData.list_price = details.listPrice
    }

    if (bookData.isbn) {
      const existing = db
        .prepare('SELECT id FROM books WHERE isbn = ?')
        .get(bookData.isbn) as { id: string } | undefined
      if (existing?.id) return { id: existing.id, isExisting: true }
    } else {
        // 如果 ISBN 为空，先检查是否已存在一个空 ISBN 的书
        // 注意：SQLite 的 UNIQUE 约束默认认为 NULL 不等于 NULL，所以可以插入多条 NULL。
        // 但这里我们可能想要避免添加重复的“无 ISBN 书籍”，或者允许。
        // 如果数据库中有一条 ISBN 为 NULL（或空字符串）的记录，而现在又插入一条 NULL，通常是可以的（除非索引是 UNIQUE 且 NOT NULL）。
        // 但如果业务逻辑认为 ISBN 必须唯一且空值只能有一个（这不合理），或者空值时不检查。
        
        // BUG 修复：用户反馈数据库里有一条 ISBN 为空的记录，导致新书（也没 ISBN）被判定为重复？
        // 不，SQLite 中 NULL != NULL。但如果存的是空字符串 ''，则 '' == ''，会冲突。
        // 我们应该确保没 ISBN 时存的是 NULL 而不是空字符串，或者生成一个临时 ID。
        
        // 策略：如果没有 ISBN，我们生成一个临时的伪 ISBN (UUID) 以避免冲突，
        // 或者直接让它为 NULL (如果表定义允许且我们不想约束它)。
        // 现在的表定义是 isbn TEXT UNIQUE。在 SQLite 中，多行可以是 NULL 且不冲突。
        // 但如果之前的代码存的是空字符串 ""，那第二本空字符串就会冲突。
        
        // 检查：如果传入的 book.isbn 是空字符串或 undefined，我们设为 NULL (如果是 undefined, SQL 参数会自动处理，但空字符串需转 NULL)
        if (bookData.isbn === '') {
            bookData.isbn = null;
        }
        
        // 如果仍然担心空字符串问题，我们可以查询一下
        // const existingEmpty = db.prepare("SELECT id FROM books WHERE isbn = ''").get()
        // if (existingEmpty) ...
    }

    const id = randomUUID()
    const stmt = db.prepare(`
      INSERT INTO books (id, isbn, title, author, translator, publisher, list_price, cover_url, description, publish_year, page_count, status)
      VALUES (@id, @isbn, @title, @author, @translator, @publisher, @list_price, @cover_url, @description, @publish_year, @page_count, @status)
    `)
    
    // 确保空 ISBN 转为 null，避免空字符串触发唯一性冲突
    const safeIsbn = bookData.isbn || null
    
    const newBook = { ...bookData, id, isbn: safeIsbn, status: bookData.status || 'unpurchased' }
    try {
        stmt.run(newBook)
        return newBook
    } catch (error: any) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
             // 如果是因为空字符串导致的冲突，我们再次尝试返回已存在
             // 或者如果是 ISBN 冲突
             const existing = db.prepare('SELECT * FROM books WHERE isbn = ?').get(safeIsbn) as any
             if (existing && typeof existing === 'object') {
               return { ...existing, isExisting: true }
             }
        }
        throw error
    }
  })

  ipcMain.handle('update-book', (event, book) => {
    const { id, ...rest } = book
    if (!id) throw new Error('ID is required for update')
    
    const keys = Object.keys(rest)
    if (keys.length === 0) return book

    const setClause = keys.map(key => `${key} = @${key}`).join(', ')
    const stmt = db.prepare(`UPDATE books SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`)
    stmt.run({ ...book })
    return db.prepare('SELECT * FROM books WHERE id = ?').get(id)
  })

  ipcMain.handle('delete-book', (event, id) => {
    db.prepare('DELETE FROM books WHERE id = ?').run(id)
    return id
  })

  // --- Series ---
  ipcMain.handle('get-series', () => {
    return db.prepare('SELECT * FROM series ORDER BY created_at DESC').all()
  })

  ipcMain.handle('add-series', (event, { name, description }) => {
    const id = randomUUID()
    db.prepare('INSERT INTO series (id, name, description) VALUES (?, ?, ?)').run(id, name, description)
    return { id, name, description }
  })

  // --- Price History ---
  ipcMain.handle('add-price-history', (event, history) => {
    const id = randomUUID()
    const stmt = db.prepare(`
      INSERT INTO price_history (id, book_id, price, original_price, discount_rate, in_stock)
      VALUES (@id, @book_id, @price, @original_price, @discount_rate, @in_stock)
    `)
    const price = Number(history?.price)
    const original =
      history?.original_price === null || history?.original_price === undefined
        ? null
        : Number(history.original_price)
    const discount = Number(history?.discount_rate ?? 0)
    const inStock = history?.in_stock ? 1 : 0

    const normalized = {
      id,
      book_id: String(history?.book_id || ''),
      price: Number.isFinite(price) ? price : 0,
      original_price: original !== null && Number.isFinite(original) ? original : null,
      discount_rate: Number.isFinite(discount) ? discount : 0,
      in_stock: inStock,
    }
    stmt.run(normalized)
    return normalized
  })
  
  ipcMain.handle('get-latest-prices', (event, bookIds) => {
     // Get latest price for each book
     if (!bookIds || bookIds.length === 0) return []
     const placeholders = bookIds.map(() => '?').join(',')
     return db.prepare(`
       SELECT ph.* 
       FROM price_history ph
       INNER JOIN (
         SELECT book_id, MAX(fetched_at) as max_date
         FROM price_history
         WHERE book_id IN (${placeholders})
         GROUP BY book_id
       ) latest ON ph.book_id = latest.book_id AND ph.fetched_at = latest.max_date
     `).all(...bookIds)
  })

  // --- External Services ---
  ipcMain.handle('search-books', async (event, query) => {
    return searchGoogleBooks(query)
  })

  ipcMain.handle('fetch-douban-details', async (event, detailUrl) => {
    return fetchDoubanSubjectDetails(detailUrl)
  })

  ipcMain.handle('fetch-jd-price', async (event, isbn) => {
    try {
      return await fetchJdPrice(isbn)
    } catch (e: any) {
      if ((e?.message || '').includes('JD_LOGIN_REQUIRED')) {
        return { authRequired: true, reason: 'login' }
      }
      if ((e?.message || '').includes('JD_RISK_REQUIRED')) {
        return { authRequired: true, reason: 'risk' }
      }
      throw e
    }
  })

  ipcMain.handle('fetch-jd-price-by-sku', async (event, payload) => {
    try {
      const skuOrUrl = payload && typeof payload === 'object' ? payload.skuOrUrl : payload
      const interactive = !!(payload && typeof payload === 'object' && payload.interactive)
      return await (interactive ? fetchJdPriceBySkuInteractive(skuOrUrl) : fetchJdPriceBySku(skuOrUrl))
    } catch (e: any) {
      if ((e?.message || '').includes('JD_LOGIN_REQUIRED')) {
        return { authRequired: true, reason: 'login' }
      }
      if ((e?.message || '').includes('JD_RISK_REQUIRED')) {
        return { authRequired: true, reason: 'risk' }
      }
      throw e
    }
  })

  ipcMain.handle('jd-auth', async (event, payload?: any) => {
    if (payload && typeof payload === 'object') {
      return openJdAuthWindow(payload.targetUrl, payload.userAgent, payload.mode)
    }
    return openJdAuthWindow(payload)
  })
}
