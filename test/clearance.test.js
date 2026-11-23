import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as T from 'three'
import { boxObstacle, checkClearance, mergeHits, nodeObstacle } from '../src/clearance.js'

test('mergeHits joins consecutive frames per pair and keeps gaps apart', () => {
  const key = (what, other) => what + '\u0000' + other
  const hits = [3, 4, 5, 9].map((frame) => ({ frame, key: key('Gripper', 'Tray A') }))
    .concat([{ frame: 4, key: key('Mounted part', 'Floor') }])
  assert.deepEqual(mergeHits(hits), [
    { from: 3, to: 5, what: 'Gripper', with: 'Tray A' },
    { from: 4, to: 4, what: 'Mounted part', with: 'Floor' },
    { from: 9, to: 9, what: 'Gripper', with: 'Tray A' },
  ])
})

test('a tool lowered onto a tray collides only once it enters the tray', () => {
  const root = new T.Group()
  const tray = new T.Mesh(new T.BoxGeometry(0.2, 0.1, 0.2))
  tray.position.set(0, 0.05, 0)
  const tool = new T.Mesh(new T.BoxGeometry(0.02, 0.02, 0.02))
  root.add(tray, tool)
  // Frame f puts the tool's bottom at 0.15 - 0.01 f metres: it enters the tray top (0.1) after frame 5 and leaves through its bottom after frame 16.
  const intervals = checkClearance({
    root, movers: [{ label: 'Gripper', meshes: [tool] }], obstacles: [boxObstacle('Tray A', tray)], floorY: 0, frames: 20,
    setFrame: (frame) => tool.position.set(0, 0.16 - 0.01 * frame, 0),
  })
  assert.deepEqual(intervals.map(({ from, to, with: other }) => [from, to, other]), [[6, 16, 'Tray A'], [16, 20, 'Floor']])
})

test('nodeObstacle wraps every mesh of a node in the node frame', () => {
  const node = new T.Group()
  node.rotation.y = Math.PI / 2
  const mesh = new T.Mesh(new T.BoxGeometry(0.4, 0.1, 0.1))
  mesh.position.x = 0.3
  node.add(mesh)
  const obstacle = nodeObstacle('Upper arm', node)
  assert.ok(Math.abs(obstacle.half.x - 0.2) < 1e-6 && Math.abs(obstacle.center.x - 0.3) < 1e-6)
})
