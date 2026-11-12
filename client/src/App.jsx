import { lazy, Suspense, useEffect, useState } from 'react'
import { Home } from './pages/Home.jsx'
import { Judge } from './pages/Judge.jsx'
// AG Studio is about 6 MB, so it loads only when the dashboard opens and the start screen stays light.
const Studio = lazy(() => import('./pages/Studio.jsx').then((m) => ({ default: m.Studio })))

function usePath() {
  const [path, setPath] = useState(window.location.pathname + window.location.search)
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname + window.location.search)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const navigate = (to) => {
    window.history.pushState({}, '', to)
    setPath(to)
  }
  return [path, navigate]
}

export function App() {
  const [path, navigate] = usePath()
  // Status chips of the open rental (mode of PayPal and Claude), reported by the rental screen.
  const [status, setStatus] = useState(null)
  const clean = path.split('?')[0]
  const judge = clean.match(/^\/judge\/([A-Za-z0-9-]+)$/)
  const studio = clean.match(/^\/studio(?:\/([A-Za-z0-9-]+))?$/)
  const sid = judge?.[1] || studio?.[1]
  const nav = (to, on, label) => <button className={`top__link${on ? ' is-on' : ''}`} aria-current={on ? 'page' : undefined} onClick={() => navigate(to)}>{label}</button>
  return (
    <>
      <header className="top">
        <div className="top__left">
          <a className="top__brand" href="/" onClick={(e) => { e.preventDefault(); navigate('/') }}><img className="brand-logo" src="/logo-512.png" width="32" height="32" alt="ReturnCheck" />Return<span>Check</span></a>
          <nav className="top__nav" aria-label="Main">
            {sid && (judge ? nav(`/judge/${sid}`, true, status?.rentalId ? `Rental ${status.rentalId}` : 'Rental') : <button className="top__link" onClick={() => navigate(`/judge/${sid}`)}>Back to the rental</button>)}
            {(judge || studio) && nav(`/studio${sid ? `/${sid}` : ''}`, !!studio, 'Fleet dashboard')}
            {nav('/', !judge && !studio, 'Start')}
          </nav>
        </div>
        {judge && status && (
          <div className="top__right">
            {status.chips.map((c) => <span key={c.text} className={`chip ${c.live ? 'chip--live' : 'chip--seed'}`}>{c.text}</span>)}
            <span className="user"><span className="avatar" aria-hidden="true">{status.staff.slice(0, 1)}</span>{status.staff}, counter</span>
          </div>
        )}
      </header>
      <div className="app">
        {judge ? <Judge sid={judge[1]} navigate={navigate} onStatus={setStatus} /> : studio ? <Suspense fallback={<p>Loading the dashboard...</p>}><Studio sid={studio[1]} /></Suspense> : <Home navigate={navigate} />}
      </div>
    </>
  )
}
