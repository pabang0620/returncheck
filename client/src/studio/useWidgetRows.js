import { useEffect, useState } from 'react'

// Reads rows for a custom widget and keeps them current when filters or cross filters change.
// `loaded` stays false until the first answer arrives, so widgets show a loading state instead of zeros.
export function useWidgetRows(widgetApi, fields) {
  const [rows, setRows] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [selections, setSelections] = useState(undefined)
  const key = fields.map((x) => `${x.key}`).join('|')
  useEffect(() => {
    let alive = true
    if (fields.some((x) => !x)) return undefined
    const take = (response) => {
      if (!alive) return
      setRows(response.results.rows || [])
      setLoaded(true)
      setSelections(widgetApi.getCrossFilterSelections())
    }
    widgetApi.getData({ fields }, { onDataUpdated: take }).then(take).catch(() => { if (alive) { setRows([]); setLoaded(true) } })
    return () => { alive = false }
  }, [widgetApi, key])
  return { rows, selections, loaded }
}
