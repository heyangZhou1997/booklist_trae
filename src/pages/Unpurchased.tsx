import { useEffect, useState } from 'react'
import { useBookStore } from '../store/bookStore'
import { RefreshCw, Loader2, Trash2, Link2 } from 'lucide-react'
import { cn } from '../lib/utils'

export function Unpurchased() {
  const { books, fetchBooks, isLoading, prices, refreshPrice, deleteBook, updateBook } = useBookStore()
  const [refreshingIds, setRefreshingIds] = useState<Record<string, boolean>>({})
  const [bindState, setBindState] = useState<{
    open: boolean
    bookId?: string
    isbn?: string
    reason?: string
    input: string
    error?: string
  }>({ open: false, input: '' })

  const parseSku = (input: string) => {
    const s = (input || '').toString()
    const m =
      s.match(/item\.jd\.com\/(\d{5,20})\.html/i) ||
      s.match(/product\/(\d{5,20})\.html/i) ||
      s.match(/[?&]skuId=(\d{5,20})/i) ||
      s.match(/\b(\d{5,20})\b/)
    return m ? m[1] : ''
  }

  useEffect(() => {
    fetchBooks('unpurchased')
  }, [fetchBooks])

  const handleRefresh = async (bookId: string, isbn?: string, jdSku?: string) => {
    if (!isbn && !jdSku) return
    // 防止重复点击
    if (refreshingIds[bookId]) return
    
    setRefreshingIds(prev => ({ ...prev, [bookId]: true }))
    try {
        const result = await refreshPrice(bookId, isbn, jdSku)
        if (result.status === 'bind_suggested') {
          const ok = confirm(`${result.reason}\n是否现在手动绑定京东商品链接/sku？`)
          if (ok) {
            setBindState({ open: true, bookId, isbn, reason: result.reason, input: '', error: undefined })
          }
        } else if (result.status === 'timeout') {
          alert('获取京东价格超时，请稍后再试')
        } else if (result.status === 'error') {
          alert(`保存京东价格失败：${result.message}`)
        } else if (result.status === 'no_price') {
          alert(result.reason)
        }
    } catch (e) {
        console.error(e)
    } finally {
        setRefreshingIds(prev => ({ ...prev, [bookId]: false }))
    }
  }

  const handleBindJd = async (bookId: string, isbn?: string) => {
    const book = books.find(b => b.id === bookId)
    const existing = book?.jd_url || book?.jd_sku || ''
    setBindState({ open: true, bookId, isbn, reason: '手动绑定京东商品链接', input: existing, error: undefined })
  }

  const confirmBind = async () => {
    const bookId = bindState.bookId
    if (!bookId) return
    const sku = parseSku(bindState.input)
    if (!sku) {
      setBindState(s => ({ ...s, error: '链接或 sku 无效，请重新输入' }))
      return
    }
    await updateBook(bookId, { jd_sku: sku, jd_url: `https://item.jd.com/${sku}.html` })
    setBindState({ open: false, input: '' })
    await handleRefresh(bookId, bindState.isbn, sku)
  }

  const clearBind = async () => {
    const bookId = bindState.bookId
    if (!bookId) return
    await updateBook(bookId, { jd_sku: undefined, jd_url: undefined })
    setBindState({ open: false, input: '' })
  }

  const handleStatusChange = async (bookId: string, status: 'reading' | 'finished') => {
      // 乐观更新 UI：先从当前列表中移除（因为当前是待购清单）
      useBookStore.setState(state => ({
          books: state.books.filter(b => b.id !== bookId)
      }))
      
      // 调用 API 更新
      const { updateBook } = useBookStore.getState()
      await updateBook(bookId, { status, start_reading_date: new Date().toISOString() })
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">待购清单</h1>
      {bindState.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white shadow-lg border p-4">
            <div className="text-sm font-bold">绑定京东商品链接</div>
            {bindState.reason && (
              <div className="mt-1 text-xs text-slate-600">{bindState.reason}</div>
            )}
            <input
              value={bindState.input}
              onChange={(e) => setBindState(s => ({ ...s, input: e.target.value, error: undefined }))}
              placeholder="粘贴 https://item.jd.com/xxxx.html 或直接输入 sku 数字"
              className="mt-3 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-200"
            />
            {bindState.error && (
              <div className="mt-2 text-xs text-red-600">{bindState.error}</div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-3 py-1.5 text-sm rounded-md border hover:bg-slate-50"
                onClick={clearBind}
              >
                解除绑定
              </button>
              <button
                className="px-3 py-1.5 text-sm rounded-md border hover:bg-slate-50"
                onClick={() => setBindState({ open: false, input: '' })}
              >
                取消
              </button>
              <button
                className="px-3 py-1.5 text-sm rounded-md bg-orange-600 text-white hover:bg-orange-700"
                onClick={confirmBind}
              >
                绑定并刷新
              </button>
            </div>
          </div>
        </div>
      )}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin w-8 h-8 text-orange-500" />
        </div>
      ) : books.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          清单为空，快去"搜索添加"加几本想买的书吧！
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
          {books.map(book => {
            const price = prices[book.id]
            const isRefreshing = refreshingIds[book.id]
            const listPrice =
              book.list_price && isFinite(Number(book.list_price)) && Number(book.list_price) > 0
                ? Number(book.list_price)
                : null
            const displayOriginal =
              price?.original_price && isFinite(Number(price.original_price)) && Number(price.original_price) > 0
                ? Number(price.original_price)
                : listPrice
            const showOriginalWithPrice = displayOriginal && price && displayOriginal > price.price

            return (
              <div key={book.id} className="bg-white rounded-lg shadow-sm border hover:shadow-md transition-all p-2 flex gap-2 group">
                <div className="relative w-[84px] h-[120px] flex-shrink-0 min-w-0">
                  <div className="w-full h-full bg-slate-100 rounded-md overflow-hidden">
                      {book.cover_url ? (
                        <img
                          src={book.cover_url}
                          alt={book.title}
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="flex items-center justify-center h-full text-slate-400 text-xs">暂无封面</div>
                      )}
                    </div>

                  {!!(price && price.discount_rate && Number(price.discount_rate) > 0) && (
                    <div className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                      -{price.discount_rate}%
                    </div>
                  )}

                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm(`确定要删除《${book.title}》吗？此操作不可撤销。`)) {
                        deleteBook(book.id)
                      }
                    }}
                    className="absolute -top-1 -left-1 z-20 p-1 rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60"
                    title="删除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleStatusChange(book.id, 'reading')
                      }}
                      className="absolute inset-x-1 bottom-1 z-10 bg-blue-600 text-white text-[11px] py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-700"
                    >
                      开始阅读
                    </button>
                  </div>

                <div className="min-w-0 flex-1 flex flex-col h-[120px]">
                  <h3 className="font-bold text-sm line-clamp-1 leading-tight" title={book.title}>
                      {book.title}
                    </h3>

                    <div className="mt-1 text-xs text-slate-600">
                      <div className="space-y-0.5 h-[56px]">
                        <p className="truncate" title={book.author}>{book.author}</p>
                        <p className="truncate text-slate-500" title={book.publisher ? `出版社: ${book.publisher}` : '出版社: 无'}>
                          {book.publisher ? `出版社: ${book.publisher}` : '出版社: 无'}
                        </p>
                        <p className="truncate text-slate-500" title={book.translator ? `译者: ${book.translator}` : ''}>
                          {book.translator ? `译者: ${book.translator}` : '译者: 无'}
                        </p>
                        <p className="truncate text-slate-500" title={book.isbn ? `ISBN: ${book.isbn}` : 'ISBN: 无'}>
                          {book.isbn ? `ISBN: ${book.isbn}` : 'ISBN: 无'}
                        </p>
                      </div>
                    </div>

                    <div className="mt-auto pt-1 flex items-center justify-between">
                      <div className="min-w-0">
                        {price ? (
                          <div className="truncate">
                            <span className="text-sm font-bold text-red-600">¥{price.price}</span>
                            {!!showOriginalWithPrice && (
                              <span className="text-[10px] text-slate-400 line-through ml-2">¥{displayOriginal}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">
                            {listPrice ? `定价 ¥${listPrice}` : '价格未知'}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleBindJd(book.id, book.isbn)
                          }}
                          disabled={isRefreshing}
                          className={cn(
                            'p-1.5 rounded-full hover:bg-slate-100 transition-colors',
                            isRefreshing && 'opacity-50 cursor-not-allowed'
                          )}
                          title="手动绑定京东商品链接"
                        >
                          <Link2 className="w-4 h-4" />
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRefresh(book.id, book.isbn, book.jd_sku)
                          }}
                          disabled={isRefreshing || (!book.isbn && !book.jd_sku)}
                          className={cn(
                            'p-1.5 rounded-full hover:bg-slate-100 transition-colors',
                            isRefreshing && 'animate-spin text-orange-500',
                            !book.isbn && !book.jd_sku && 'opacity-50 cursor-not-allowed'
                          )}
                          title={book.isbn || book.jd_sku ? '刷新京东价格' : '无ISBN且未绑定京东链接，无法获取价格'}
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
