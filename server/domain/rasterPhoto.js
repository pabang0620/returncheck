import { HttpError } from '../http.js'

// Checks a base64 photo really is a PNG or JPEG (magic bytes) and reads its pixel size from the header.
// The client's claim about the media type is never trusted.
export function inspectRaster(base64, claimedType) {
  const buf = Buffer.from(base64, 'base64')
  if (buf.length < 24) throw new HttpError(400, 'That file is too small to be a photo.')
  if (buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return finish('image/png', claimedType, buf.readUInt32BE(16), buf.readUInt32BE(20))
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue }
      const marker = buf[i + 1]
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return finish('image/jpeg', claimedType, buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5))
      i += 2 + buf.readUInt16BE(i + 2)
    }
    throw new HttpError(400, 'Could not read the size of that JPEG.')
  }
  throw new HttpError(400, 'Only JPEG and PNG photos are accepted.')
}

function finish(mediaType, claimed, width, height) {
  if (claimed !== mediaType) throw new HttpError(400, `The file is ${mediaType}, not ${claimed}.`)
  if (!width || !height || width > 12000 || height > 12000) throw new HttpError(400, 'Unreasonable photo size.')
  return { mediaType, width, height }
}
