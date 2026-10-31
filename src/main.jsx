import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import Orb from './Orb.jsx'
import './styles.css'

const winType = new URLSearchParams(window.location.search).get('win') || 'main'
document.documentElement.dataset.win = winType

createRoot(document.getElementById('root')).render(
  <React.StrictMode>{winType === 'orb' ? <Orb /> : <App />}</React.StrictMode>
)
