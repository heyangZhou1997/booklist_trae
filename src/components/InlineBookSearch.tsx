import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Search as SearchIcon } from 'lucide-react'
import { api } from '../lib/api'
import { useBookStore } from '../store/bookStore'

type SearchBook = {
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
  listPrice?: number
}

export function InlineBookSearch(props: { defaultStatus: 'unpurchased' | 'unread' }) {
  const { addBook } = useBookStore()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchBook[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [visibleCount, setVisibleCount] = useState(3)

  const resultsKey = useMemo(() => results.map(r => r.detailUrl || `${r.title}|${r.author}`).join('||'), [results])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const tasks = results
        .filter(r => r.detailUrl && (!r.isbn || !r.publisher || !r.translator || !r.listPrice))
        .slice(0, 12)
        .map(async (r) => {
          try {
            const details = await api.fetchDoubanDetails(r.detailUrl as string)
            const patch: Partial<SearchBook> = {}
            if (!r.isbn && details?.isbn) patch.isbn = details.isbn
            if (!r.publisher && details?.publisher) patch.publisher = details.publisher
            if (!r.translator && details?.translator) patch.translator = details.translator
            if (!r.listPrice && details?.listPrice) patch.listPrice = details.listPrice
            if (Object.keys(patch).length === 0) return
            if (cancelled) return
            setResults(prev => prev.map(x => (x.detailUrl === r.detailUrl ? { ...x, ...patch } : x)))
          } catch {
            // ignore
          }
        })
      await Promise.all(tasks)
    }
    if (results.length > 0) run()
    return () => {
      cancelled = true
    }
  }, [resultsKey])

  const handleSearch = async () => {
    const q = query.trim()
    if (!q) return
    setLoading(true)
    try {
      const data = await api.searchBooks(q)
      setResults(Array.isArray(data) ? data : [])
      setVisibleCount(3)
      setOpen(true)
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = async (book: SearchBook) => {
    try {
      const now = new Date().toISOString()
      const payload: any = {
        title: book.title,
        author: book.author,
        translator: book.translator,
        publisher: book.publisher,
        publish_year: book.publishDate ? parseInt(book.publishDate.substring(0, 4)) : undefined,
        description: book.description,
        cover_url: book.coverUrl,
        isbn: book.isbn,
        detailUrl: book.detailUrl,
        page_count: book.pageCount,
        list_price: book.listPrice,
        status: props.defaultStatus,
      }
      if (props.defaultStatus === 'unread') {
        payload.purchase_date = now
      }
      const result = await addBook(payload)
      // @ts-ignore
      if (result && result.isExisting) {
        alert('这本书已经在您的书单中了！')
      } else {
        setQuery('')
        setResults([])
        setOpen(false)
      }
    } catch (error) {
      console.error('Failed to add book', error)
      alert('添加书籍失败，请重试')
    }
  }

  return (
    <div className="relative">
      <div className="bg-white rounded-lg shadow-sm border p-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <SearchIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="输入书名或ISBN搜索添加..."
              className="w-full pl-9 pr-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 text-sm"
              onFocus={() => {
                if (results.length > 0) setOpen(true)
              }}
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={loading}
            className="bg-orange-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-orange-700 disabled:opacity-50 flex items-center gap-2 text-sm"
          >
            {loading ? <Loader2 className="animate-spin w-4 h-4" /> : <Plus className="w-4 h-4" />}
            搜索
          </button>
        </div>
      </div>

      {open && (
        <div className="absolute left-0 right-0 mt-2 z-40 bg-white rounded-lg shadow-lg border overflow-hidden">
          <div className="max-h-[60vh] overflow-auto">
            {results.length === 0 ? (
              <div className="p-4 text-sm text-slate-500">暂无结果</div>
            ) : (
              <div className="divide-y">
                {results.slice(0, visibleCount).map((book, index) => (
                  <div key={index} className="p-3 flex gap-3 hover:bg-slate-50">
                    <div className="w-14 h-20 bg-slate-100 rounded overflow-hidden flex-shrink-0">
                      {book.coverUrl ? (
                        <img src={book.coverUrl} alt={book.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : null}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm truncate" title={book.title}>{book.title}</div>
                      <div className="text-xs text-slate-600 truncate">{book.author}</div>
                      <div className="text-xs text-slate-500 mt-0.5 truncate">
                        {book.publisher ? `出版社：${book.publisher}` : '出版社：无'}
                        {book.publishDate && `（${book.publishDate.substring(0, 4)}）`}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 truncate">{book.translator ? `译者：${book.translator}` : '译者：无'}</div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
                        <span className="font-mono">{book.isbn ? `ISBN: ${book.isbn}` : 'ISBN: 无'}</span>
                        <span>{book.listPrice ? `定价: ¥${book.listPrice}` : '定价: 无'}</span>
                        {typeof book.pageCount === 'number' && book.pageCount > 0 && (
                          <span>{`页数: ${book.pageCount}`}</span>
                        )}
                      </div>
                      {book.description && (
                        <div className="text-xs text-slate-500 mt-1 line-clamp-2">{book.description}</div>
                      )}
                    </div>
                    <div className="flex items-center">
                      <button
                        onClick={() => handleAdd(book)}
                        className="p-2 bg-slate-100 rounded-full hover:bg-orange-100 hover:text-orange-600 transition-colors"
                        title="添加"
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
                {results.length > visibleCount && (
                  <button
                    className="w-full py-3 text-sm text-slate-500 hover:text-orange-600 hover:bg-orange-50 border-t border-dashed transition-colors"
                    onClick={() => setVisibleCount(c => c + 5)}
                  >
                    ↓ 点击加载更多
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="p-2 bg-slate-50 flex justify-end">
            <button
              className="px-3 py-1.5 text-sm rounded-md border bg-white hover:bg-slate-50"
              onClick={() => setOpen(false)}
            >
              收起
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

