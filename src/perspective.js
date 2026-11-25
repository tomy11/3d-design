import { blobFromDataUrl, imageFromCanvas, maxTraceSize } from './trace.js'

// Straightens a photo taken at an angle: four picked corners of a real rectangle (a sheet of
// paper, a drawing border, the part's own square face) are mapped back to a true rectangle.

// Sorts four points into top-left, top-right, bottom-right, bottom-left (image y down).
export function orderCorners(points) {
  const cx = points.reduce((sum, [x]) => sum + x, 0) / points.length
  const cy = points.reduce((sum, [, y]) => sum + y, 0) / points.length
  return [...points].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx))
}

export function isConvex(quad) {
  let sign = 0
  for (let index = 0; index < 4; index++) {
    const [ax, ay] = quad[index]
    const [bx, by] = quad[(index + 1) % 4]
    const [cx, cy] = quad[(index + 2) % 4]
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx)
    if (Math.abs(cross) < 1e-9) return false
    if (sign && Math.sign(cross) !== sign) return false
    sign = Math.sign(cross)
  }
  return true
}

// The 3x3 projective map (as 8 numbers, h8 = 1) taking each from[i] to to[i].
export function homography(from, to) {
  const rows = []
  for (let index = 0; index < 4; index++) {
    const [u, v] = from[index]
    const [x, y] = to[index]
    rows.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x])
    rows.push([0, 0, 0, u, v, 1, -u * y, -v * y, y])
  }
  for (let column = 0; column < 8; column++) {
    let pivot = column
    for (let row = column + 1; row < 8; row++) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row
    if (Math.abs(rows[pivot][column]) < 1e-12) throw new Error('The corners do not form a rectangle in perspective.')
    ;[rows[column], rows[pivot]] = [rows[pivot], rows[column]]
    for (let row = 0; row < 8; row++) {
      if (row === column) continue
      const factor = rows[row][column] / rows[column][column]
      for (let k = column; k < 9; k++) rows[row][k] -= factor * rows[column][k]
    }
  }
  return rows.map((row, index) => row[8] / row[index])
}

export function project(h, [u, v]) {
  const w = h[6] * u + h[7] * v + 1
  return [(h[0] * u + h[1] * v + h[2]) / w, (h[3] * u + h[4] * v + h[5]) / w]
}

// The straightened size in pixels. With a known real width and height the aspect is exact;
// otherwise it is estimated from the average lengths of opposite edges.
export function straightenedSize(quad, aspect = null) {
  const length = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1])
  const across = (length(quad[0], quad[1]) + length(quad[3], quad[2])) / 2
  const down = (length(quad[0], quad[3]) + length(quad[1], quad[2])) / 2
  const ratio = aspect ?? across / down
  let width = Math.max(across, down * ratio)
  let height = width / ratio
  const fit = Math.min(1, maxTraceSize / Math.max(width, height))
  width = Math.max(8, Math.round(width * fit))
  height = Math.max(8, Math.round(height * fit))
  return { width, height }
}

async function pixelsOf(image) {
  const bitmap = await createImageBitmap(blobFromDataUrl(image.url))
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(bitmap, 0, 0, image.width, image.height)
  bitmap.close()
  return context.getImageData(0, 0, image.width, image.height)
}

// Returns a new trace image of the rectangle seen through the four corners.
export async function straightenImage(image, corners, aspect = null) {
  const quad = orderCorners(corners)
  if (!isConvex(quad)) throw new Error('Pick four corners that form a four-sided shape.')
  const { width, height } = straightenedSize(quad, aspect)
  // Pixel edges of the output map to the picked corners.
  const h = homography([[0, 0], [width, 0], [width, height], [0, height]], quad)
  const source = await pixelsOf(image)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const output = context.createImageData(width, height)
  const { data, width: sw, height: sh } = source
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Sample at the pixel centre, bilinear.
      const [sx, sy] = project(h, [x + 0.5, y + 0.5])
      const fx = Math.max(0, Math.min(sw - 1, sx - 0.5))
      const fy = Math.max(0, Math.min(sh - 1, sy - 0.5))
      const x0 = Math.floor(fx)
      const y0 = Math.floor(fy)
      const x1 = Math.min(sw - 1, x0 + 1)
      const y1 = Math.min(sh - 1, y0 + 1)
      const tx = fx - x0
      const ty = fy - y0
      const target = (y * width + x) * 4
      for (let channel = 0; channel < 4; channel++) {
        const top = data[(y0 * sw + x0) * 4 + channel] * (1 - tx) + data[(y0 * sw + x1) * 4 + channel] * tx
        const bottom = data[(y1 * sw + x0) * 4 + channel] * (1 - tx) + data[(y1 * sw + x1) * 4 + channel] * tx
        output.data[target + channel] = top * (1 - ty) + bottom * ty
      }
    }
  }
  context.putImageData(output, 0, 0)
  const name = image.name.replace(/(\.[a-z0-9]+)?$/i, ' (straightened)$1')
  return imageFromCanvas(canvas, name)
}
