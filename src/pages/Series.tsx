import { useEffect, useState } from 'react'
import { useBookStore } from '../store/bookStore'
import { Plus, Loader2 } from 'lucide-react'

export function Series() {
  const { series, fetchSeries, addSeries } = useBookStore()
  const [isCreating, setIsCreating] = useState(false)
  const [newSeriesName, setNewSeriesName] = useState('')
  const [newSeriesDesc, setNewSeriesDesc] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchSeries()
  }, [fetchSeries])

  const handleCreate = async () => {
    if (!newSeriesName.trim()) return
    setLoading(true)
    try {
      await addSeries({ name: newSeriesName, description: newSeriesDesc })
      setNewSeriesName('')
      setNewSeriesDesc('')
      setIsCreating(false)
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
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
              <label className="block text-sm font-medium text-slate-700 mb-1">描述（可选）</label>
              <textarea 
                value={newSeriesDesc}
                onChange={e => setNewSeriesDesc(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                rows={3}
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

      {series.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          暂无系列，您可以创建系列来归类书籍。
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {series.map(s => (
            <div key={s.id} className="bg-white p-6 rounded-xl shadow-sm border hover:shadow-md transition-shadow">
              <h3 className="font-bold text-lg mb-2">{s.name}</h3>
              <p className="text-slate-500 text-sm mb-4">{s.description || '暂无描述'}</p>
              <div className="text-xs text-slate-400">
                创建于 {new Date(s.created_at!).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
