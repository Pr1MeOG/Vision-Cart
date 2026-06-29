import React from 'react'
import ReactDOM from 'react-dom/client'
import '../sentry.client.js'
import AuthPage from './AuthPage.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthPage />
  </React.StrictMode>,
)
