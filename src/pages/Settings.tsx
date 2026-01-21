export function Settings() {
  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">设置</h1>
      <div className="bg-white p-6 rounded-xl shadow-sm border">
        <h2 className="text-lg font-bold mb-4">数据管理</h2>
        <div className="flex gap-4">
          <button className="px-4 py-2 bg-slate-100 rounded-lg hover:bg-slate-200">
            导出数据
          </button>
          <button className="px-4 py-2 bg-slate-100 rounded-lg hover:bg-slate-200">
            导入数据
          </button>
        </div>
      </div>
    </div>
  )
}
