import { Link, useLocation } from 'react-router-dom'
import { BookOpen, ShoppingCart, Layers, Settings, Home } from 'lucide-react'
import { cn } from '../lib/utils'

const navItems = [
  { href: '/', label: '概览', icon: Home },
  { href: '/unpurchased', label: '待购清单', icon: ShoppingCart },
  { href: '/purchased', label: '我的书架', icon: BookOpen },
  { href: '/series', label: '系列管理', icon: Layers },
  { href: '/settings', label: '设置', icon: Settings },
]

export function Sidebar() {
  const location = useLocation()

  return (
    <div className="w-64 h-full bg-slate-900 text-slate-100 flex flex-col flex-shrink-0">
      <div className="p-6">
        <h1 className="text-xl font-bold text-orange-500 flex items-center gap-2">
          <BookOpen className="w-6 h-6" />
          BookList
        </h1>
      </div>
      
      <nav className="flex-1 px-4 space-y-2">
        {navItems.map((item) => {
          const isActive = location.pathname === item.href
          return (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-lg transition-colors",
                isActive 
                  ? "bg-orange-600 text-white shadow-lg shadow-orange-900/20" 
                  : "hover:bg-slate-800 text-slate-300"
              )}
            >
              <item.icon className="w-5 h-5" />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>
      
      <div className="p-4 border-t border-slate-800">
        <div className="text-xs text-slate-500 text-center">
          v0.0.1
        </div>
      </div>
    </div>
  )
}
