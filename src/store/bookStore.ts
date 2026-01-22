import { create } from 'zustand'
import { Book, Series, PriceHistory } from '../types'
import { api } from '../lib/api'

interface BookState {
  books: Book[]
  series: Series[]
  isLoading: boolean
  error: string | null
  
  fetchBooks: (status?: string) => Promise<void>
  fetchSeries: () => Promise<void>
  addSeries: (series: Partial<Series>) => Promise<Series>
  updateSeries: (series: Partial<Series> & { id: string }) => Promise<Series>
  addBookToSeries: (seriesId: string, bookId: string) => Promise<void>
  removeBookFromSeries: (seriesId: string, bookId: string) => Promise<void>
  reorderSeriesBooks: (seriesId: string, orderedBookIds: string[]) => Promise<void>
  addBook: (book: Partial<Book>) => Promise<Book & { isExisting?: boolean }>
  updateBook: (id: string, updates: Partial<Book>) => Promise<void>
  deleteBook: (id: string) => Promise<void>
  
  // Price related
  prices: Record<string, PriceHistory> // bookId -> latest price
  fetchPrices: (bookIds: string[]) => Promise<void>
  refreshPrice: (
    bookId: string,
    isbn?: string,
    jdSku?: string
  ) => Promise<
    | { status: 'ok' }
    | { status: 'bind_suggested', reason: string }
    | { status: 'no_price', reason: string }
    | { status: 'timeout' }
    | { status: 'error', message: string }
  >
}

export const useBookStore = create<BookState>((set, get) => ({
  books: [],
  series: [],
  isLoading: false,
  error: null,
  prices: {},

  fetchBooks: async (status) => {
    set({ isLoading: true, error: null })
    try {
      const books = await api.getBooks({ status })
      set({ books, isLoading: false })
      
      // Also fetch prices for these books
      if (books.length > 0) {
        const ids = books.map(b => b.id)
        get().fetchPrices(ids)
      }
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false })
    }
  },

  fetchSeries: async () => {
    try {
      const series = await api.getSeries()
      set({ series })
    } catch (error) {
      console.error('Failed to fetch series', error)
    }
  },

  addSeries: async (seriesData) => {
    try {
      const newSeries = await api.addSeries(seriesData)
      set(state => ({ series: [newSeries, ...state.series] }))
      return newSeries
    } catch (error) {
      console.error('Failed to add series', error)
      throw error
    }
  },

  updateSeries: async (seriesData) => {
    try {
      const updated = await api.updateSeries(seriesData)
      set(state => ({ series: state.series.map(s => (s.id === updated.id ? updated : s)) }))
      return updated
    } catch (error) {
      console.error('Failed to update series', error)
      throw error
    }
  },

  addBookToSeries: async (seriesId, bookId) => {
    await api.addBookToSeries({ seriesId, bookId })
  },

  removeBookFromSeries: async (seriesId, bookId) => {
    await api.removeBookFromSeries({ seriesId, bookId })
  },

  reorderSeriesBooks: async (seriesId, orderedBookIds) => {
    await api.reorderSeriesBooks({ seriesId, orderedBookIds })
  },

  addBook: async (bookData) => {
    try {
      const newBook = await api.addBook(bookData)
      // @ts-ignore
      if (!newBook.isExisting) {
          set(state => ({ books: [newBook, ...state.books] }))
      }
      return newBook
    } catch (error) {
      set({ error: (error as Error).message })
      throw error
    }
  },

  updateBook: async (id, updates) => {
    try {
      // Optimistic update
      set(state => ({
        books: state.books.map(b => b.id === id ? { ...b, ...updates } : b)
      }))
      await api.updateBook({ id, ...updates })
    } catch (error) {
      // Revert on failure? For now just log
      console.error('Failed to update book', error)
      // Ideally re-fetch
      get().fetchBooks()
    }
  },

  deleteBook: async (id) => {
    try {
      set(state => ({ books: state.books.filter(b => b.id !== id) }))
      await api.deleteBook(id)
    } catch (error) {
      console.error('Failed to delete book', error)
    }
  },

  fetchPrices: async (bookIds: string[]) => {
    try {
      const prices = await api.getLatestPrices(bookIds)
      const priceMap: Record<string, PriceHistory> = {}
      prices.forEach(p => {
        priceMap[p.book_id] = p
      })
      set(state => ({ prices: { ...state.prices, ...priceMap } }))
    } catch (error) {
      console.error('Failed to fetch prices', error)
    }
  },

  refreshPrice: async (bookId: string, isbn?: string, jdSku?: string) => {
    const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number) => {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          setTimeout(() => reject(new Error('JD_REFRESH_TIMEOUT')), timeoutMs)
        }),
      ])
    }

    try {
      if (!isbn && !jdSku) {
        return { status: 'no_price', reason: '缺少 ISBN 或京东商品链接，无法获取价格' }
      }

      const book = get().books.find(b => b.id === bookId)
      const bookListPrice =
        book?.list_price && isFinite(Number(book.list_price)) && Number(book.list_price) > 0
          ? Number(book.list_price)
          : null

      const priceInfo = jdSku
        ? await withTimeout(api.fetchJdPriceBySku(jdSku), 45000)
        : await withTimeout(api.fetchJdPrice(isbn as string), 45000)
      if (priceInfo && priceInfo.authRequired) {
        if (jdSku) {
          const ok = confirm('需要通过京东安全验证/登录才能获取实时价格，将打开京东商品页并自动抓取价格。继续吗？')
          if (!ok) return { status: 'no_price', reason: '已取消登录/验证' }
          const interactive = await withTimeout(
            api.fetchJdPriceBySku({ skuOrUrl: jdSku, interactive: true }),
            200000
          )
          if (interactive && !interactive.authRequired && !interactive.noPriceReason) {
            const baseOriginal = bookListPrice
            if (interactive.sku) {
              get().updateBook(bookId, { jd_sku: interactive.sku, jd_url: interactive.url }).catch(() => {})
            }
            const history = await api.addPriceHistory({
              book_id: bookId,
              price: interactive.price,
              original_price: baseOriginal,
              in_stock: interactive.inStock,
              discount_rate: baseOriginal && baseOriginal > interactive.price ? Math.round((1 - interactive.price / baseOriginal) * 100) : 0
            })
            set(state => ({
              prices: { ...state.prices, [bookId]: history }
            }))
            return { status: 'ok' }
          }
          return { status: 'no_price', reason: '未能从商品页抓取价格，请在页面停留片刻后重试' }
        }

        const ok = confirm('需要通过京东安全验证/登录才能获取自营实时价格，是否现在去京东完成验证？')
        if (!ok) return { status: 'no_price', reason: '已取消登录/验证' }
        const targetUrl = `https://search.jd.com/Search?keyword=${encodeURIComponent(isbn as string)}&enc=utf-8`
        const mode = priceInfo.reason === 'login' ? 'login' : 'risk'
        const authed = await api.jdAuth({ targetUrl, mode })
        if (!authed) return { status: 'no_price', reason: '登录/验证未完成' }
        const retried = await withTimeout(api.fetchJdPrice(isbn as string), 45000)
        if (!retried || retried.authRequired) return { status: 'no_price', reason: '京东仍需验证' }
        if (retried && retried.noPriceReason) {
          set(state => {
            const prices = { ...state.prices }
            delete prices[bookId]
            return { prices }
          })
          if (retried?.debug?.blocked === 'search_rate_limited') {
            return { status: 'bind_suggested', reason: '京东搜索触发频控，建议手动绑定商品链接以绕过搜索。' }
          }
          return {
            status: 'bind_suggested',
            reason: retried.noPriceReason === 'no_self'
              ? '未找到京东自营商品，建议手动绑定商品链接。'
              : '暂时无法获取京东价格，建议手动绑定商品链接。',
          }
        }
        const retriedBaseOriginal = bookListPrice
        if (retried.sku) {
          get().updateBook(bookId, { jd_sku: retried.sku, jd_url: retried.url }).catch(() => {})
        }
        const history = await api.addPriceHistory({
          book_id: bookId,
          price: retried.price,
          original_price: retriedBaseOriginal,
          in_stock: retried.inStock,
          discount_rate: retriedBaseOriginal && retriedBaseOriginal > retried.price ? Math.round((1 - retried.price / retriedBaseOriginal) * 100) : 0
        })
        set(state => ({
          prices: { ...state.prices, [bookId]: history }
        }))
        return { status: 'ok' }
      }
      if (priceInfo && priceInfo.noPriceReason) {
        if (priceInfo.debug) console.log('JD debug', priceInfo.debug)
        set(state => {
          const prices = { ...state.prices }
          delete prices[bookId]
          return { prices }
        })
        if (jdSku) {
          return { status: 'no_price', reason: '已绑定商品链接，但仍未能获取价格，请稍后再试' }
        }
        if (priceInfo?.debug?.blocked === 'search_rate_limited') {
          return { status: 'bind_suggested', reason: '京东搜索触发频控，建议手动绑定商品链接以绕过搜索。' }
        } else {
          return { status: 'bind_suggested', reason: '暂时无法获取京东价格，建议手动绑定商品链接。' }
        }
      }
      if (priceInfo) {
        const baseOriginal = bookListPrice
        if (priceInfo.sku) {
          get().updateBook(bookId, { jd_sku: priceInfo.sku, jd_url: priceInfo.url }).catch(() => {})
        }
        // Save to DB
        const history = await api.addPriceHistory({
          book_id: bookId,
          price: priceInfo.price,
          original_price: baseOriginal,
          in_stock: priceInfo.inStock,
          discount_rate: baseOriginal && baseOriginal > priceInfo.price ? Math.round((1 - priceInfo.price / baseOriginal) * 100) : 0
        })
        // Update local state
        set(state => ({
          prices: { ...state.prices, [bookId]: history }
        }))
        return { status: 'ok' }
      } else {
        set(state => {
          const prices = { ...state.prices }
          delete prices[bookId]
          return { prices }
        })
        return { status: 'bind_suggested', reason: '暂时无法获取京东价格，建议手动绑定商品链接。' }
      }
    } catch (error) {
      console.error('Failed to refresh price', error)
      const msg = (error as any)?.message || ''
      if (msg === 'JD_REFRESH_TIMEOUT') {
        return { status: 'timeout' }
      }
      return { status: 'error', message: msg || '未知错误' }
    }
  }
}))
