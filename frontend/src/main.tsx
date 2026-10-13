import React from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <main>
      <h1>任务管线可观测</h1>
      <p>前端项目框架已就绪。</p>
    </main>
  </React.StrictMode>,
)
