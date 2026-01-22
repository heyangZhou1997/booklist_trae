import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { useBookStore } from '../store/bookStore'
import { useNavigate } from 'react-router-dom'
import { Loader2, Plus } from 'lucide-react'

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

export function Search() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchBook[]>([])
  const [loading, setLoading] = useState(false)
  const [visibleCount, setVisibleCount] = useState(3)
  const { addBook } = useBookStore()
  const navigate = useNavigate()

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
    if (!query.trim()) return
    setLoading(true)
    try {
      const data = await api.searchBooks(query)
      setResults(Array.isArray(data) ? data : [])
      setVisibleCount(3)
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = async (book: SearchBook) => {
    try {
      const result = await addBook({
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
        status: 'unpurchased'
      })
      
      // @ts-ignore
      if (result && result.isExisting) {
        alert('这本书已经在您的书单中了！')
      } else {
        navigate('/unpurchased')
      }
    } catch (error) {
      console.error('Failed to add book', error)
      alert('添加书籍失败，请重试')
    }
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">添加新书</h1>
      <div className="max-w-3xl mx-auto">
        <div className="flex gap-2 mb-8">
          <input 
            type="text" 
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="输入书名或ISBN搜索..." 
            className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          <button 
            onClick={handleSearch}
            disabled={loading}
            className="bg-orange-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-orange-700 disabled:opacity-50 flex items-center gap-2"
          >
            {loading && <Loader2 className="animate-spin w-4 h-4" />}
            搜索
          </button>
        </div>
        
        <div className="space-y-4">
          {results.slice(0, visibleCount).map((book, index) => (
            <div key={index} className="bg-white p-4 rounded-lg shadow-sm border flex gap-4 hover:shadow-md transition-shadow">
              {book.coverUrl ? (
                <img src={book.coverUrl} alt={book.title} className="w-24 h-36 object-cover rounded shadow flex-shrink-0" />
              ) : (
                <div className="w-24 h-36 bg-slate-200 rounded flex items-center justify-center text-slate-400 flex-shrink-0">
                  暂无封面
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-lg truncate" title={book.title}>{book.title}</h3>
                <p className="text-slate-600 truncate">{book.author}</p>
                <p className="text-sm text-slate-500 mt-1 truncate" title={book.publisher || ''}>
                  {book.publisher ? `出版社：${book.publisher}` : '出版社：无'}
                  {book.publishDate && `（${book.publishDate.substring(0, 4)}）`}
                </p>
                <p className="text-sm text-slate-500 mt-0.5 truncate" title={book.translator || ''}>
                  {book.translator ? `译者：${book.translator}` : '译者：无'}
                </p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
                  <span className="font-mono">{book.isbn ? `ISBN: ${book.isbn}` : 'ISBN: 无'}</span>
                  <span>{book.listPrice ? `定价: ¥${book.listPrice}` : '定价: 无'}</span>
                  {typeof book.pageCount === 'number' && book.pageCount > 0 && (
                    <span>{`页数: ${book.pageCount}`}</span>
                  )}
                </div>
                {book.description && (
                  <p className="text-sm text-slate-500 mt-2 line-clamp-2">{book.description}</p>
                )}
              </div>
              <div className="flex flex-col justify-center">
                <button 
                  onClick={() => handleAdd(book)}
                  className="p-3 bg-slate-100 rounded-full hover:bg-orange-100 hover:text-orange-600 transition-colors"
                  title="添加到待购清单"
                >
                  <Plus className="w-6 h-6" />
                </button>
              </div>
            </div>
          ))}
          {results.length > visibleCount && (
            <button
              className="w-full py-3 text-sm text-slate-500 hover:text-orange-600 hover:bg-orange-50 border border-dashed rounded-lg transition-colors"
              onClick={() => setVisibleCount(c => c + 5)}
            >
              ↓ 点击加载更多
            </button>
          )}
          {results.length === 0 && !loading && query && (
             <div className="text-center text-slate-500 py-10">未找到相关书籍</div>
          )}
        </div>
      </div>
    </div>
  )
}
