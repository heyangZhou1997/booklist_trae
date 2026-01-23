import { useEffect } from 'react'
import { useBookStore } from '../store/bookStore'

export function Home() {
  const { books, fetchBooks } = useBookStore()

  useEffect(() => {
    // 概览页需要加载所有书籍来统计
    fetchBooks()
  }, [fetchBooks])

  const totalBooks = books.length
  const toBuyBooks = books.filter(b => b.status === 'unpurchased').length
  const unreadBooks = books.filter(b => b.status === 'unread').length
  const readingBooks = books.filter(b => b.status === 'reading').length
  const finishedBooks = books.filter(b => b.status === 'finished').length

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">概览</h1>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h3 className="text-slate-500 text-sm font-medium mb-2">总藏书</h3>
          <p className="text-3xl font-bold text-slate-900">{totalBooks}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h3 className="text-slate-500 text-sm font-medium mb-2">待购清单</h3>
          <p className="text-3xl font-bold text-orange-600">{toBuyBooks}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h3 className="text-slate-500 text-sm font-medium mb-2">待阅读</h3>
          <p className="text-3xl font-bold text-slate-900">{unreadBooks}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h3 className="text-slate-500 text-sm font-medium mb-2">正在阅读</h3>
          <p className="text-3xl font-bold text-blue-600">{readingBooks}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h3 className="text-slate-500 text-sm font-medium mb-2">已阅读</h3>
          <p className="text-3xl font-bold text-green-600">{finishedBooks}</p>
        </div>
      </div>
      
      {/* 最近活动或推荐 */}
      <div className="mt-8">
        <h2 className="text-xl font-bold mb-4">阅读状态</h2>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
             <div className="flex items-center gap-4">
                 <div className="flex-1">
                     <div className="flex justify-between text-sm mb-1">
                         <span>已阅读</span>
                         <span className="font-bold">{finishedBooks} 本</span>
                     </div>
                     <div className="w-full bg-slate-100 rounded-full h-2.5">
                         <div className="bg-green-500 h-2.5 rounded-full" style={{ width: totalBooks > 0 ? `${(finishedBooks / totalBooks) * 100}%` : '0%' }}></div>
                     </div>
                 </div>
             </div>
        </div>
      </div>
    </div>
  )
}
