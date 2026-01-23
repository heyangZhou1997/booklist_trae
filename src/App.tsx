import { HashRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Home } from './pages/Home'
import { Unpurchased } from './pages/Unpurchased'
import { Purchased } from './pages/Purchased'
import { Series } from './pages/Series'
import { Settings } from './pages/Settings'

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="unpurchased" element={<Unpurchased />} />
          <Route path="purchased" element={<Purchased />} />
          <Route path="series" element={<Series />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

export default App
