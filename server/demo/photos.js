import { historyPhotoDescriptor, photoDescriptor, ASSET_HISTORY } from './seed.js'

const PALETTE = { ink: '#1F2328', paper: '#F6F4EF', accent: '#C2410C' }

function zoneShape(zone) {
  switch (zone) {
    case 'body_front':
      return '<rect x="90" y="110" width="620" height="380" rx="46" fill="#2b2f36"/><circle cx="400" cy="300" r="120" fill="#16181d"/><circle cx="400" cy="300" r="82" fill="#0d0e11"/><rect x="120" y="150" width="90" height="300" rx="30" fill="#353a43"/>'
    case 'top_plate':
      return '<rect x="90" y="150" width="620" height="300" rx="30" fill="#2b2f36"/><circle cx="210" cy="260" r="62" fill="#3d434d"/><circle cx="600" cy="250" r="44" fill="#3d434d"/><rect x="330" y="170" width="140" height="70" rx="10" fill="#454c57"/>'
    case 'rear_lcd':
      return '<rect x="110" y="110" width="580" height="380" rx="26" fill="#2b2f36"/><rect x="160" y="150" width="480" height="300" rx="10" fill="#0e1218"/>'
    case 'lens_mount':
      return '<circle cx="400" cy="300" r="230" fill="#2b2f36"/><circle cx="400" cy="300" r="170" fill="#9aa3ad"/><circle cx="400" cy="300" r="140" fill="#14161a"/>'
    case 'lens_front':
      return '<circle cx="400" cy="300" r="240" fill="#23262c"/><circle cx="400" cy="300" r="190" fill="#14161a"/><circle cx="400" cy="300" r="120" fill="#243046"/><circle cx="400" cy="300" r="60" fill="#0e131c"/>'
    case 'lens_barrel':
    default:
      return '<rect x="60" y="150" width="680" height="300" rx="24" fill="#2b2f36"/>' + Array.from({ length: 14 }, (_, i) => `<rect x="${90 + i * 46}" y="170" width="18" height="260" fill="#363c46"/>`).join('')
  }
}

function defectShape(d) {
  if (d.kind === 'scratch') return `<rect x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}" rx="3" fill="#e8e6e0" opacity="0.9" transform="rotate(-6 ${d.x} ${d.y})"/>`
  if (d.kind === 'dent') return `<ellipse cx="${d.x + d.w / 2}" cy="${d.y + d.h / 2}" rx="${d.w / 2}" ry="${d.h / 2}" fill="#0c0d10"/><ellipse cx="${d.x + d.w / 2 - 6}" cy="${d.y + d.h / 2 - 6}" rx="${d.w / 3}" ry="${d.h / 3}" fill="#7a808a" opacity="0.7"/>`
  if (d.kind === 'dust') return Array.from({ length: 9 }, (_, i) => `<circle cx="${d.x + ((i * 17) % d.w)}" cy="${d.y + ((i * 23) % d.h)}" r="2.4" fill="#cfcfc8" opacity="0.8"/>`).join('')
  return `<ellipse cx="${d.x + d.w / 2}" cy="${d.y + d.h / 2}" rx="${d.w / 2}" ry="${d.h / 2}" fill="#b9bfc7" opacity="0.55"/>`
}

export function renderPhotoSvg(descriptor) {
  const { width, height, zone, kind, defects } = descriptor
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`
    + `<rect width="${width}" height="${height}" fill="${PALETTE.paper}"/>`
    + `<rect x="8" y="8" width="${width - 16}" height="${height - 16}" fill="#e9e5db"/>`
    + zoneShape(zone)
    + defects.map(defectShape).join('')
    + `<text x="24" y="${height - 22}" font-family="Inter, Arial, sans-serif" font-size="22" fill="${PALETTE.ink}">${kind} / ${zone}</text></svg>`
}

// Photo registry for one session: descriptors keyed by photo id.
export function buildPhotoIndex(setId, zones) {
  const index = {}
  for (const zone of zones) {
    for (const kind of ['before', 'after', 'closeup']) {
      const d = photoDescriptor(setId, kind, zone)
      index[d.id] = d
    }
  }
  for (const byZone of Object.values(ASSET_HISTORY)) {
    for (const [zone, entries] of Object.entries(byZone)) {
      for (const e of entries) index[e.photoId] = historyPhotoDescriptor(e.photoId, zone, e.hasMark)
    }
  }
  return index
}

export const beforePhotoId = (setId, zone) => photoDescriptor(setId, 'before', zone).id
export const afterPhotoId = (setId, zone) => photoDescriptor(setId, 'after', zone).id
export const closeupPhotoId = (setId, zone) => photoDescriptor(setId, 'closeup', zone).id
