import { useEffect, useMemo, useState } from 'react'
import { useBookStore } from '../store/bookStore'
import { cn } from '../lib/utils'
import { Trash2 } from 'lucide-react'

export function Purchased() {
  const { books, fetchBooks, isLoading, updateBook, deleteBook } = useBookStore()
  const [finishDates, setFinishDates] = useState<Record<string, string>>({})
  const [showExtraInfo, setShowExtraInfo] = useState<Record<string, boolean>>({})

  useEffect(() => {
    fetchBooks()
  }, [fetchBooks])

  const shelfBooks = useMemo(() => books.filter(b => b.status !== 'unpurchased'), [books])

  const setBookFinishDate = (bookId: string, value: string) => {
    setFinishDates(prev => ({ ...prev, [bookId]: value }))
  }

  const handleMarkFinished = async (bookId: string) => {
    const date = finishDates[bookId] || new Date().toISOString().slice(0, 10)
    setBookFinishDate(bookId, date)
    await updateBook(bookId, { status: 'finished', finish_reading_date: `${date}T00:00:00.000Z` })
  }

  const handleUpdateFinishedDate = async (bookId: string) => {
    const date = finishDates[bookId]
    if (!date) return
    await updateBook(bookId, { finish_reading_date: `${date}T00:00:00.000Z` })
  }

  const handleBackToReading = async (bookId: string) => {
    await updateBook(bookId, { status: 'reading', finish_reading_date: null as any })
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">我的书架</h1>
      {isLoading ? (
        <div className="flex justify-center py-20 text-slate-500">加载中...</div>
      ) : shelfBooks.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          您的书架是空的。
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {shelfBooks.map(book => {
            const finishDateValue =
              finishDates[book.id] ||
              (book.finish_reading_date ? book.finish_reading_date.slice(0, 10) : '')
            const isExtra = showExtraInfo[book.id]

            return (
              <div key={book.id} className="bg-white rounded-lg shadow-sm border hover:shadow-md transition-all p-2 flex gap-2 group">
                <div className="relative w-[84px] h-[132px] flex-shrink-0 min-w-0">
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
                      className="absolute -top-1 -right-1 p-1 rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60"
                      title="删除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                </div>

                <div className="min-w-0 flex-1 flex flex-col h-[132px]">
                  <h3 className="font-bold text-sm line-clamp-1 leading-tight" title={book.title}>
                      {book.title}
                    </h3>

                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setShowExtraInfo(prev => ({ ...prev, [book.id]: !prev[book.id] }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          setShowExtraInfo(prev => ({ ...prev, [book.id]: !prev[book.id] }))
                        }
                      }}
                    className="mt-1 text-xs text-slate-600 select-none cursor-pointer"
                      title="点击切换展示内容"
                    >
                      <div className="space-y-0.5 h-[42px]">
                        <p className="truncate" title={book.author}>{book.author}</p>
                        {isExtra ? (
                          <>
                            <p className="truncate text-slate-500">{book.isbn ? `ISBN: ${book.isbn}` : 'ISBN: 无'}</p>
                            <p className="truncate text-slate-500 opacity-0">占位</p>
                          </>
                        ) : (
                          <>
                            <p className="truncate text-slate-500" title={book.publisher ? `出版社: ${book.publisher}` : '出版社: 无'}>
                              {book.publisher ? `出版社: ${book.publisher}` : '出版社: 无'}
                            </p>
                            <p className={cn('truncate text-slate-500', !book.translator && 'opacity-0')} title={book.translator ? `译者: ${book.translator}` : ''}>
                              {book.translator ? `译: ${book.translator}` : '占位'}
                            </p>
                          </>
                        )}
                      </div>
                    </div>

                  <div className="mt-auto pt-2 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                      <label className="text-xs text-slate-600 whitespace-nowrap">读完</label>
                        <input
                          type="date"
                          value={finishDateValue}
                          onChange={(e) => setBookFinishDate(book.id, e.target.value)}
                        className="flex-1 px-2 py-1 border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 text-xs h-7"
                        />
                      </div>

                      <div className="flex gap-2">
                        {book.status === 'reading' ? (
                          <button
                            onClick={() => handleMarkFinished(book.id)}
                          className="flex-1 bg-green-600 text-white px-2 h-7 rounded-lg font-medium hover:bg-green-700 text-xs"
                          >
                            读完
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => handleUpdateFinishedDate(book.id)}
                              disabled={!finishDateValue}
                            className="flex-1 bg-orange-600 text-white px-2 h-7 rounded-lg font-medium hover:bg-orange-700 disabled:opacity-50 text-xs"
                            >
                              保存
                            </button>
                            <button
                              onClick={() => handleBackToReading(book.id)}
                            className="px-2 h-7 rounded-lg font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs"
                              title="改为阅读中"
                            >
                              阅读中
                            </button>
                          </>
                        )}
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
