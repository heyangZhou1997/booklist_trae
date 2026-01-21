import { useState } from 'react'
import { api } from '../lib/api'
import { useBookStore } from '../store/bookStore'
import { useNavigate } from 'react-router-dom'
import { Loader2, Plus } from 'lucide-react'

export function Search() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const { addBook } = useBookStore()
  const navigate = useNavigate()

  const handleSearch = async () => {
    if (!query.trim()) return
    setLoading(true)
    try {
      const data = await api.searchBooks(query)
      setResults(data)
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = async (book: any) => {
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
          {results.map((book, index) => (
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
                <p className="text-sm text-slate-500 mt-1">{book.publisher} {book.publishDate && `(${book.publishDate.substring(0, 4)})`}</p>
                {book.isbn && <p className="text-xs text-slate-400 mt-1 font-mono">ISBN: {book.isbn}</p>}
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
          {results.length === 0 && !loading && query && (
             <div className="text-center text-slate-500 py-10">未找到相关书籍</div>
          )}
        </div>
      </div>
    </div>
  )
}
