import { Routes, Route } from 'react-router-dom'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<h1 className="p-8 text-2xl font-bold">Hello World</h1>} />
    </Routes>
  )
}
