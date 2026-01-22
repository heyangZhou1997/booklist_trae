import { useEffect, useMemo, useState } from 'react'
import { useBookStore } from '../store/bookStore'
import { cn } from '../lib/utils'
import { Trash2, Check, RotateCcw } from 'lucide-react'

export function Purchased() {
  const { books, fetchBooks, isLoading, updateBook, deleteBook } = useBookStore()
  const [finishPicker, setFinishPicker] = useState<{
    open: boolean
    bookId?: string
    date: string
  }>({ open: false, date: new Date().toISOString().slice(0, 10) })

  useEffect(() => {
    fetchBooks()
  }, [fetchBooks])

  const shelfBooks = useMemo(() => {
    const list = books.filter(b => b.status !== 'unpurchased')
    list.sort((a, b) => {
      if (a.status !== b.status) {
        if (a.status === 'reading') return -1
        if (b.status === 'reading') return 1
      }

      if (a.status === 'reading' && b.status === 'reading') {
        const da = (a.start_reading_date || '').toString()
        const db = (b.start_reading_date || '').toString()
        return db.localeCompare(da)
      }

      const da = (a.finish_reading_date || '').toString()
      const db = (b.finish_reading_date || '').toString()
      return db.localeCompare(da)
    })
    return list
  }, [books])

  const handleBackToReading = async (bookId: string) => {
    await updateBook(bookId, { status: 'reading', finish_reading_date: null as any })
  }

  const openFinishPicker = (bookId: string) => {
    const book = shelfBooks.find(b => b.id === bookId)
    const existing = book?.finish_reading_date ? book.finish_reading_date.slice(0, 10) : ''
    setFinishPicker({
      open: true,
      bookId,
      date: existing || new Date().toISOString().slice(0, 10),
    })
  }

  const confirmFinish = async () => {
    const bookId = finishPicker.bookId
    if (!bookId) return
    const date = finishPicker.date || new Date().toISOString().slice(0, 10)
    setFinishPicker(s => ({ ...s, open: false }))
    await updateBook(bookId, { status: 'finished', finish_reading_date: `${date}T00:00:00.000Z` })
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">我的书架</h1>
      {finishPicker.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white shadow-lg border p-4">
            <div className="text-sm font-bold">设置读完日期</div>
            <input
              type="date"
              value={finishPicker.date}
              onChange={(e) => setFinishPicker(s => ({ ...s, date: e.target.value }))}
              className="mt-3 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-200"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-3 py-1.5 text-sm rounded-md border hover:bg-slate-50"
                onClick={() => setFinishPicker(s => ({ ...s, open: false }))}
              >
                取消
              </button>
              <button
                className="px-3 py-1.5 text-sm rounded-md bg-green-600 text-white hover:bg-green-700"
                onClick={confirmFinish}
              >
                设为已读完
              </button>
            </div>
          </div>
        </div>
      )}
      {isLoading ? (
        <div className="flex justify-center py-20 text-slate-500">加载中...</div>
      ) : shelfBooks.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          您的书架是空的。
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
          {shelfBooks.map(book => {
            const finishedDate = book.finish_reading_date ? book.finish_reading_date.slice(0, 10) : ''

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

                    <div
                      className={cn(
                        'absolute -top-1 -left-1 text-[10px] font-bold px-1.5 py-0.5 rounded',
                        book.status === 'reading' ? 'bg-blue-600 text-white' : 'bg-green-600 text-white'
                      )}
                    >
                      {book.status === 'reading' ? '阅读中' : '已读完'}
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (confirm(`确定要删除《${book.title}》吗？此操作不可撤销。`)) {
                          deleteBook(book.id)
                        }
                      }}
                      className="absolute -top-1 -right-1 z-20 p-1 rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60"
                      title="删除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
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
                      {book.status === 'reading' ? (
                        <span className="text-xs text-slate-500">阅读中</span>
                      ) : (
                        <span className="text-xs text-slate-500">{finishedDate ? `读完: ${finishedDate}` : '已读完'}</span>
                      )}
                    </div>

                    <button
                      onClick={() => {
                        if (book.status === 'reading') openFinishPicker(book.id)
                        else handleBackToReading(book.id)
                      }}
                      className="p-1.5 rounded-full hover:bg-slate-100 transition-colors"
                      title={book.status === 'reading' ? '设为已读完' : '改为阅读中'}
                    >
                      {book.status === 'reading' ? (
                        <Check className="w-4 h-4 text-green-600" />
                      ) : (
                        <RotateCcw className="w-4 h-4 text-blue-600" />
                      )}
                    </button>
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
