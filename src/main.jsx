import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import Orb from './Orb.jsx'
import Notch from './Notch.jsx'
import './styles.css'

const winType = new URLSearchParams(window.location.search).get('win') || 'main'
document.documentElement.dataset.win = winType

const view = winType === 'orb' ? <Orb /> : winType === 'notch' ? <Notch /> : <App />

createRoot(document.getElementById('root')).render(<React.StrictMode>{view}</React.StrictMode>)
