import assert from 'node:assert/strict'
import { test } from 'node:test'
import { homography, isConvex, orderCorners, project, straightenedSize } from '../src/perspective.js'

const quad = [[260, 90], [820, 150], [930, 840], [130, 760]]

test('orders corners top-left, top-right, bottom-right, bottom-left whatever the click order', () => {
  assert.deepEqual(orderCorners([quad[2], quad[0], quad[3], quad[1]]), quad)
})

test('rejects a crossed four-sided shape', () => {
  assert.equal(isConvex(quad), true)
  assert.equal(isConvex([quad[0], quad[2], quad[1], quad[3]]), false)
})

test('the homography maps each rectangle corner onto its picked corner', () => {
  const rectangle = [[0, 0], [210, 0], [210, 297], [0, 297]]
  const h = homography(rectangle, quad)
  rectangle.forEach((corner, index) => {
    const [x, y] = project(h, corner)
    assert.ok(Math.hypot(x - quad[index][0], y - quad[index][1]) < 1e-6)
  })
  // Straight lines stay straight: the rectangle centre lands on the crossing of the diagonals.
  const [cx, cy] = project(h, [105, 148.5])
  const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
  assert.ok(Math.abs(cross(quad[0], quad[2], [cx, cy])) < 1e-6 * 1e4)
  assert.ok(Math.abs(cross(quad[1], quad[3], [cx, cy])) < 1e-6 * 1e4)
})

test('a known real size sets the exact proportions, within the image size limit', () => {
  const { width, height } = straightenedSize(quad, 210 / 297)
  assert.ok(Math.abs(width / height - 210 / 297) < 0.01)
  assert.ok(Math.max(width, height) <= 720)
  const estimated = straightenedSize([[0, 0], [200, 0], [200, 100], [0, 100]])
  assert.deepEqual(estimated, { width: 200, height: 100 })
})
