import { Book, Series, PriceHistory } from '../types'

// Add type definition for window.ipcRenderer
declare global {
  interface Window {
    ipcRenderer: {
      invoke(channel: string, ...args: any[]): Promise<any>
      on(channel: string, listener: (event: any, ...args: any[]) => void): void
      off(channel: string, ...args: any[]): void
      send(channel: string, ...args: any[]): void
    }
  }
}

export const api = {
  getBooks: (params?: { status?: string, limit?: number, offset?: number }) => 
    window.ipcRenderer.invoke('get-books', params) as Promise<Book[]>,
  
  getBook: (id: string) => 
    window.ipcRenderer.invoke('get-book', id) as Promise<Book>,
  
  addBook: (book: Partial<Book>) => 
    window.ipcRenderer.invoke('add-book', book) as Promise<Book>,
  
  updateBook: (book: Partial<Book> & { id: string }) => 
    window.ipcRenderer.invoke('update-book', book) as Promise<Book>,
  
  deleteBook: (id: string) => 
    window.ipcRenderer.invoke('delete-book', id) as Promise<string>,
  
  getSeries: () => 
    window.ipcRenderer.invoke('get-series') as Promise<Series[]>,
    
  addSeries: (series: Partial<Series>) => 
    window.ipcRenderer.invoke('add-series', series) as Promise<Series>,
    
  addPriceHistory: (history: Partial<PriceHistory>) => 
    window.ipcRenderer.invoke('add-price-history', history) as Promise<PriceHistory>,

  getLatestPrices: (bookIds: string[]) =>
    window.ipcRenderer.invoke('get-latest-prices', bookIds) as Promise<PriceHistory[]>,

  searchBooks: (query: string) =>
    window.ipcRenderer.invoke('search-books', query) as Promise<any[]>,

  fetchDoubanDetails: (detailUrl: string) =>
    window.ipcRenderer.invoke('fetch-douban-details', detailUrl) as Promise<any>,

  fetchJdPrice: (isbn: string) =>
    window.ipcRenderer.invoke('fetch-jd-price', isbn) as Promise<any>,

  fetchJdPriceBySku: (payload: string | { skuOrUrl: string, interactive?: boolean }) =>
    window.ipcRenderer.invoke('fetch-jd-price-by-sku', payload) as Promise<any>,

  jdAuth: (payload?: string | { targetUrl?: string, userAgent?: string, mode?: 'risk' | 'login' }) =>
    window.ipcRenderer.invoke('jd-auth', payload) as Promise<boolean>,
}
