import { useEffect, useMemo, useState } from 'react'
import { useBookStore } from '../store/bookStore'
import { cn } from '../lib/utils'
import { Trash2, Check, RotateCcw, FolderPlus, BookOpen } from 'lucide-react'
import { InlineBookSearch } from '../components/InlineBookSearch'

export function Purchased() {
  const { books, fetchBooks, fetchSeries, series, addSeries, addBookToSeries, isLoading, updateBook, deleteBook } = useBookStore()
  const [finishPicker, setFinishPicker] = useState<{
    open: boolean
    bookId?: string
    date: string
  }>({ open: false, date: new Date().toISOString().slice(0, 10) })
  const [seriesState, setSeriesState] = useState<{
    open: boolean
    bookId?: string
    selectedSeriesId: string
    createName: string
    createAuthor: string
  }>({ open: false, selectedSeriesId: '', createName: '', createAuthor: '' })

  useEffect(() => {
    fetchBooks()
  }, [fetchBooks])

  useEffect(() => {
    fetchSeries()
  }, [fetchSeries])

  const shelfBooks = useMemo(() => books.filter(b => b.status !== 'unpurchased'), [books])

  const readingBooks = useMemo(() => {
    const list = shelfBooks.filter(b => b.status === 'reading')
    list.sort((a, b) => (b.start_reading_date || '').toString().localeCompare((a.start_reading_date || '').toString()))
    return list
  }, [shelfBooks])

  const unreadBooks = useMemo(() => {
    const list = shelfBooks.filter(b => b.status === 'unread')
    list.sort((a, b) => {
      const da = (a.purchase_date || a.created_at || '').toString()
      const db = (b.purchase_date || b.created_at || '').toString()
      return db.localeCompare(da)
    })
    return list
  }, [shelfBooks])

  const finishedBooks = useMemo(() => {
    const list = shelfBooks.filter(b => b.status === 'finished')
    list.sort((a, b) => (b.finish_reading_date || '').toString().localeCompare((a.finish_reading_date || '').toString()))
    return list
  }, [shelfBooks])

  const handleBackToReading = async (bookId: string) => {
    await updateBook(bookId, { status: 'reading', finish_reading_date: null as any })
  }

  const handleStartReading = async (bookId: string) => {
    const now = new Date().toISOString()
    await updateBook(bookId, { status: 'reading', start_reading_date: now })
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

  const openSeriesPicker = async (bookId: string) => {
    await fetchSeries()
    const first = series[0]?.id || ''
    setSeriesState({ open: true, bookId, selectedSeriesId: first, createName: '', createAuthor: '' })
  }

  const confirmSeries = async () => {
    const bookId = seriesState.bookId
    if (!bookId) return
    let seriesId = seriesState.selectedSeriesId
    if (seriesId === '__new__' || !seriesId) {
      if (!seriesState.createName.trim()) return
      const created = await addSeries({ name: seriesState.createName.trim(), author: seriesState.createAuthor.trim() })
      seriesId = created.id
    }
    await addBookToSeries(seriesId, bookId)
    setSeriesState({ open: false, selectedSeriesId: '', createName: '', createAuthor: '' })
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">我的书架</h1>
      <div className="mb-4">
        <InlineBookSearch defaultStatus="unread" />
      </div>
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
      {seriesState.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white shadow-lg border p-4">
            <div className="text-sm font-bold">加入系列</div>
            <div className="mt-3 space-y-3">
              <div>
                <label className="block text-xs text-slate-600 mb-1">选择系列</label>
                <select
                  value={seriesState.selectedSeriesId || '__new__'}
                  onChange={(e) => setSeriesState(s => ({ ...s, selectedSeriesId: e.target.value }))}
                  className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-200"
                >
                  {series.map(s => (
                    <option key={s.id} value={s.id}>{s.author ? `${s.name}（${s.author}）` : s.name}</option>
                  ))}
                  <option value="__new__">+ 新建系列</option>
                </select>
              </div>
              {(seriesState.selectedSeriesId === '__new__' || series.length === 0) && (
                <>
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">系列名称</label>
                    <input
                      value={seriesState.createName}
                      onChange={(e) => setSeriesState(s => ({ ...s, createName: e.target.value }))}
                      className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-200"
                      placeholder="例如：东野圭吾推理系列"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-600 mb-1">系列作者（可选）</label>
                    <input
                      value={seriesState.createAuthor}
                      onChange={(e) => setSeriesState(s => ({ ...s, createAuthor: e.target.value }))}
                      className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-200"
                      placeholder="例如：东野圭吾"
                    />
                  </div>
                </>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-3 py-1.5 text-sm rounded-md border hover:bg-slate-50"
                onClick={() => setSeriesState({ open: false, selectedSeriesId: '', createName: '', createAuthor: '' })}
              >
                取消
              </button>
              <button
                className="px-3 py-1.5 text-sm rounded-md bg-orange-600 text-white hover:bg-orange-700"
                onClick={confirmSeries}
              >
                确定
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
        <div className="space-y-6">
          {[
            { key: 'reading', title: '阅读中', list: readingBooks },
            { key: 'unread', title: '待阅读', list: unreadBooks },
            { key: 'finished', title: '已读完', list: finishedBooks },
          ].filter(section => section.list.length > 0).map(section => (
            <div key={section.key}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-xl font-bold text-slate-800">{section.title}</div>
                <div className="text-xs text-slate-400">{section.list.length} 本</div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
                {section.list.map(book => {
                  const finishedDate = book.finish_reading_date ? book.finish_reading_date.slice(0, 10) : ''
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
                            book.status === 'reading'
                              ? 'bg-blue-600 text-white'
                              : book.status === 'finished'
                                ? 'bg-green-600 text-white'
                                : 'bg-slate-700 text-white'
                          )}
                        >
                          {book.status === 'reading' ? '阅读中' : book.status === 'finished' ? '已读完' : '待阅读'}
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

                      <div className="min-w-0 flex-1 flex flex-col h-[132px]">
                        <h3 className="font-bold text-[16px] line-clamp-1 leading-tight" title={book.title}>
                          {book.title}
                        </h3>
                        <p className="text-xs text-slate-600 truncate mt-0.5" title={book.author}>
                          {book.author}
                        </p>

                        <div className="mt-2 text-xs text-slate-600">
                          <div className="space-y-0.5 h-[48px]">
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
                            ) : book.status === 'unread' ? (
                              <span className="text-xs text-slate-500">待阅读</span>
                            ) : (
                              finishedDate ? (
                                <span className="text-[13px] font-bold text-red-600 whitespace-nowrap">{`${finishedDate} 读完`}</span>
                              ) : (
                                <span className="text-xs text-slate-500">已读完</span>
                              )
                            )}
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => openSeriesPicker(book.id)}
                              className="p-1.5 rounded-full hover:bg-slate-100 transition-colors"
                              title="加入系列"
                            >
                              <FolderPlus className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => {
                                if (book.status === 'reading') openFinishPicker(book.id)
                                else if (book.status === 'finished') handleBackToReading(book.id)
                                else handleStartReading(book.id)
                              }}
                              className="p-1.5 rounded-full hover:bg-slate-100 transition-colors"
                              title={book.status === 'reading' ? '设为已读完' : book.status === 'finished' ? '改为阅读中' : '开始阅读'}
                            >
                              {book.status === 'reading' ? (
                                <Check className="w-4 h-4 text-green-600" />
                              ) : book.status === 'finished' ? (
                                <RotateCcw className="w-4 h-4 text-blue-600" />
                              ) : (
                                <BookOpen className="w-4 h-4 text-blue-600" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
