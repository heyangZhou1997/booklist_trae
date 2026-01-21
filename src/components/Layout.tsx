import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'

export function Layout() {
  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-slate-50">
        <div className="container mx-auto p-6 min-h-full">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
