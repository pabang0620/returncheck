import { useEffect, useState } from 'react'
import { loadKeys } from '../api.js'

// A photo the staff uploaded. The server only serves it with the staff key, so it is fetched with the header
// and shown through an object URL instead of a plain <img src>.
export function UploadedPhoto({ sid, kind, zone, version, alt }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let url = ''
    let live = true
    fetch(`/api/s/${sid}/uploads/${kind}/${zone}`, { headers: { 'x-staff-key': loadKeys(sid)?.staffKey || '' } })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (!blob || !live) return
        url = URL.createObjectURL(blob)
        setSrc(url)
      })
      .catch(() => setSrc(''))
    return () => {
      live = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [sid, kind, zone, version])
  if (!src) return <div className="photo" role="img" aria-label={`${alt} (loading)`} />
  return <img className="upload-thumb" src={src} alt={alt} />
}
