import { useEffect, useMemo, useState } from 'react'
import { useBookStore } from '../store/bookStore'
import { Plus, Loader2, Settings2, BookPlus, ChevronUp, ChevronDown, Trash2 } from 'lucide-react'
import { Book, Series as SeriesType } from '../types'
import { api } from '../lib/api'
import { cn } from '../lib/utils'

export function Series() {
  const { series, books, prices, fetchPrices, fetchSeries, fetchBooks, addSeries, updateSeries, addBookToSeries, removeBookFromSeries, reorderSeriesBooks } = useBookStore()
  const [isCreating, setIsCreating] = useState(false)
  const [newSeriesName, setNewSeriesName] = useState('')
  const [newSeriesAuthor, setNewSeriesAuthor] = useState('')
  const [loading, setLoading] = useState(false)
  const [seriesWithBooks, setSeriesWithBooks] = useState<Array<SeriesType & { books: Book[] }>>([])
  const [addBooksState, setAddBooksState] = useState<{ open: boolean, seriesId?: string, filter: string, selected: Record<string, boolean> }>({ open: false, filter: '', selected: {} })
  const [manageState, setManageState] = useState<{ open: boolean, seriesId?: string }>({ open: false })
  const [editSeriesState, setEditSeriesState] = useState<{ name: string, author: string, saving: boolean }>({ name: '', author: '', saving: false })

  useEffect(() => {
    fetchSeries()
  }, [fetchSeries])

  const refreshSeriesWithBooks = async () => {
    const data = await api.getSeriesWithBooks()
    setSeriesWithBooks(Array.isArray(data) ? data : [])
  }

  useEffect(() => {
    refreshSeriesWithBooks().catch(() => {})
  }, [series.length])

  useEffect(() => {
    const ids = Array.from(new Set(seriesWithBooks.flatMap(s => (s.books || []).map(b => b.id))))
    if (ids.length > 0) fetchPrices(ids)
  }, [seriesWithBooks, fetchPrices])

  const handleCreate = async () => {
    if (!newSeriesName.trim()) return
    setLoading(true)
    try {
      await addSeries({ name: newSeriesName, author: newSeriesAuthor })
      setNewSeriesName('')
      setNewSeriesAuthor('')
      setIsCreating(false)
      await fetchSeries()
      await refreshSeriesWithBooks()
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const openAddBooks = async (seriesId: string) => {
    if (books.length === 0) await fetchBooks()
    setAddBooksState({ open: true, seriesId, filter: '', selected: {} })
  }

  const addBooksTargetSeries = useMemo(() => seriesWithBooks.find(s => s.id === addBooksState.seriesId), [seriesWithBooks, addBooksState.seriesId])

  const selectableBooks = useMemo(() => {
    const s = addBooksTargetSeries
    const existing = new Set((s?.books || []).map(b => b.id))
    const q = addBooksState.filter.trim()
    const list = books.filter(b => !existing.has(b.id))
    if (!q) return list
    return list.filter(b => {
      const hay = `${b.title}|${b.author}|${b.publisher || ''}|${b.translator || ''}|${b.isbn || ''}`
      return hay.toLowerCase().includes(q.toLowerCase())
    })
  }, [books, addBooksTargetSeries, addBooksState.filter])

  const confirmAddBooks = async () => {
    const seriesId = addBooksState.seriesId
    if (!seriesId) return
    const ids = Object.keys(addBooksState.selected).filter(k => addBooksState.selected[k])
    if (ids.length === 0) {
      setAddBooksState(s => ({ ...s, open: false }))
      return
    }
    await Promise.all(ids.map(bookId => addBookToSeries(seriesId, bookId)))
    setAddBooksState({ open: false, filter: '', selected: {} })
    await refreshSeriesWithBooks()
  }

  const openManage = async (seriesId: string) => {
    setManageState({ open: true, seriesId })
    const s = seriesWithBooks.find(x => x.id === seriesId)
    setEditSeriesState({ name: s?.name || '', author: s?.author || '', saving: false })
  }

  const managedSeries = useMemo(() => seriesWithBooks.find(s => s.id === manageState.seriesId), [seriesWithBooks, manageState.seriesId])

  const saveSeriesMeta = async () => {
    const seriesId = manageState.seriesId
    if (!seriesId) return
    const name = editSeriesState.name.trim()
    if (!name) return
    setEditSeriesState(s => ({ ...s, saving: true }))
    try {
      await updateSeries({ id: seriesId, name, author: editSeriesState.author.trim() })
      await fetchSeries()
      await refreshSeriesWithBooks()
    } finally {
      setEditSeriesState(s => ({ ...s, saving: false }))
    }
  }

  const moveBook = async (dir: -1 | 1, bookId: string) => {
    if (!managedSeries) return
    const arr = [...managedSeries.books]
    const idx = arr.findIndex(b => b.id === bookId)
    const next = idx + dir
    if (idx < 0 || next < 0 || next >= arr.length) return
    const tmp = arr[idx]
    arr[idx] = arr[next]
    arr[next] = tmp
    setSeriesWithBooks(prev => prev.map(s => (s.id === managedSeries.id ? { ...s, books: arr } : s)))
    await reorderSeriesBooks(managedSeries.id, arr.map(b => b.id))
    await refreshSeriesWithBooks()
  }

  const removeFromSeries = async (seriesId: string, bookId: string) => {
    await removeBookFromSeries(seriesId, bookId)
    await refreshSeriesWithBooks()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">系列管理</h1>
        <button 
          onClick={() => setIsCreating(true)}
          className="bg-orange-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-orange-700"
        >
          <Plus className="w-4 h-4" />
          新建系列
        </button>
      </div>

      {isCreating && (
        <div className="bg-white p-6 rounded-xl shadow-sm border mb-6 animate-in fade-in slide-in-from-top-4">
          <h3 className="font-bold mb-4">创建新系列</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">系列名称</label>
              <input 
                type="text" 
                value={newSeriesName}
                onChange={e => setNewSeriesName(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                placeholder="例如：哈利波特全集"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">系列作者（可选）</label>
              <input
                type="text"
                value={newSeriesAuthor}
                onChange={e => setNewSeriesAuthor(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                placeholder="例如：东野圭吾"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setIsCreating(false)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                取消
              </button>
              <button 
                onClick={handleCreate}
                disabled={loading || !newSeriesName.trim()}
                className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 flex items-center gap-2"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {addBooksState.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-3xl rounded-lg bg-white shadow-lg border p-4">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-sm font-bold truncate">添加书籍到系列：{addBooksTargetSeries?.name}</div>
                {addBooksTargetSeries?.author && <div className="text-xs text-slate-500 truncate">{addBooksTargetSeries.author}</div>}
              </div>
              <button className="px-3 py-1.5 text-sm rounded-md border hover:bg-slate-50" onClick={() => setAddBooksState(s => ({ ...s, open: false }))}>
                关闭
              </button>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <input
                value={addBooksState.filter}
                onChange={(e) => setAddBooksState(s => ({ ...s, filter: e.target.value }))}
                placeholder="按书名/作者/ISBN筛选..."
                className="flex-1 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-200"
              />
              <button
                className="px-3 py-2 text-sm rounded-md bg-orange-600 text-white hover:bg-orange-700"
                onClick={confirmAddBooks}
              >
                添加
              </button>
            </div>

            <div className="mt-3 max-h-[60vh] overflow-auto rounded-md border">
              {selectableBooks.length === 0 ? (
                <div className="p-4 text-sm text-slate-500">没有可添加的书籍</div>
              ) : (
                <div className="divide-y">
                  {selectableBooks.map(b => (
                    <label key={b.id} className="flex items-center gap-3 p-3 hover:bg-slate-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!addBooksState.selected[b.id]}
                        onChange={(e) => setAddBooksState(s => ({ ...s, selected: { ...s.selected, [b.id]: e.target.checked } }))}
                      />
                      <div className="w-10 h-14 bg-slate-100 rounded overflow-hidden flex-shrink-0">
                        {b.cover_url ? (
                          <img src={b.cover_url} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold truncate">{b.title}</div>
                        <div className="text-xs text-slate-500 truncate">{b.author}</div>
                      </div>
                      <div className="text-xs text-slate-400 whitespace-nowrap">{b.status === 'unpurchased' ? '待购' : b.status === 'reading' ? '阅读中' : '已读完'}</div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {manageState.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-lg bg-white shadow-lg border p-4">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-sm font-bold truncate">管理系列：{managedSeries?.name}</div>
                {managedSeries?.author && <div className="text-xs text-slate-500 truncate">{managedSeries.author}</div>}
              </div>
              <button className="px-3 py-1.5 text-sm rounded-md border hover:bg-slate-50" onClick={() => setManageState({ open: false })}>
                关闭
              </button>
            </div>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-600 mb-1">系列名称</label>
                <input
                  value={editSeriesState.name}
                  onChange={(e) => setEditSeriesState(s => ({ ...s, name: e.target.value }))}
                  className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-200"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">系列作者（可选）</label>
                <input
                  value={editSeriesState.author}
                  onChange={(e) => setEditSeriesState(s => ({ ...s, author: e.target.value }))}
                  className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-200"
                />
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <button
                className={cn(
                  'px-3 py-1.5 text-sm rounded-md bg-orange-600 text-white hover:bg-orange-700',
                  editSeriesState.saving && 'opacity-50 pointer-events-none'
                )}
                onClick={saveSeriesMeta}
              >
                保存系列信息
              </button>
            </div>
            <div className="mt-3 max-h-[65vh] overflow-auto rounded-md border divide-y">
              {(managedSeries?.books || []).map((b, idx) => (
                <div key={b.id} className="flex items-center gap-3 p-3">
                  <div className="w-10 h-14 bg-slate-100 rounded overflow-hidden flex-shrink-0">
                    {b.cover_url ? (
                      <img src={b.cover_url} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold truncate">{b.title}</div>
                    <div className="text-xs text-slate-500 truncate">{b.author}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      className={cn('p-1 rounded hover:bg-slate-100', idx === 0 && 'opacity-40 pointer-events-none')}
                      onClick={() => moveBook(-1, b.id)}
                      title="上移"
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button
                      className={cn('p-1 rounded hover:bg-slate-100', idx === (managedSeries?.books.length || 0) - 1 && 'opacity-40 pointer-events-none')}
                      onClick={() => moveBook(1, b.id)}
                      title="下移"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                    <button
                      className="p-1 rounded hover:bg-slate-100 text-red-600"
                      onClick={() => removeFromSeries(managedSeries!.id, b.id)}
                      title="移出系列"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
              {(managedSeries?.books || []).length === 0 && (
                <div className="p-4 text-sm text-slate-500">该系列暂无书籍</div>
              )}
            </div>
          </div>
        </div>
      )}

      {seriesWithBooks.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          暂无系列，您可以创建系列来归类书籍。
        </div>
      ) : (
        <div className="space-y-3">
          {seriesWithBooks.map(s => (
            <div key={s.id} className="bg-white p-5 rounded-xl shadow-sm border hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex items-baseline gap-2">
                  <div className="font-bold truncate">{s.name}</div>
                  <div className="text-sm text-slate-500 truncate">{s.author || ''}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="px-3 py-1.5 text-sm rounded-md border hover:bg-slate-50 flex items-center gap-1.5"
                    onClick={() => openAddBooks(s.id)}
                  >
                    <BookPlus className="w-4 h-4" />
                    添加书籍
                  </button>
                  <button
                    className="px-3 py-1.5 text-sm rounded-md border hover:bg-slate-50 flex items-center gap-1.5"
                    onClick={() => openManage(s.id)}
                  >
                    <Settings2 className="w-4 h-4" />
                    管理
                  </button>
                </div>
              </div>

              <div className="mt-3 overflow-x-auto">
                <div className="flex gap-4 min-w-max py-1 px-2">
                  {(s as any).books.slice(0, 12).map((b: Book) => (
                    <div key={b.id} className="w-[92px] flex-shrink-0">
                      <div className="relative w-[92px] h-[132px]">
                        <div className="absolute inset-0 bg-slate-100 rounded-md overflow-hidden">
                          {b.cover_url ? (
                            <img src={b.cover_url} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          ) : null}
                        </div>
                        {b.status !== 'unpurchased' ? (
                          <div
                            className={cn(
                              'absolute -top-1 -left-1 text-[10px] font-bold px-1.5 py-0.5 rounded z-10',
                              b.status === 'reading' ? 'bg-blue-600 text-white' : 'bg-green-600 text-white'
                            )}
                          >
                            {b.status === 'reading' ? '阅读中' : '已读完'}
                          </div>
                        ) : (
                          (() => {
                            const p = prices[b.id]
                            const dr = p?.discount_rate ? Number(p.discount_rate) : 0
                            if (!p || !isFinite(dr) || dr <= 0) return null
                            return (
                              <div className="absolute -top-1 -left-1 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded z-10">
                                -{dr}%
                              </div>
                            )
                          })()
                        )}
                      </div>
                      <div className="mt-1 text-xs font-medium line-clamp-2 text-center">{b.title}</div>
                    </div>
                  ))}
                  {(s as any).books.length === 0 && (
                    <div className="text-sm text-slate-500 py-6">该系列暂无书籍</div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
