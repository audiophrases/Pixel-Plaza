import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { receiveHandOff } from './studentAuth'
import { receiveTester } from './tester'

receiveHandOff()
receiveTester()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
