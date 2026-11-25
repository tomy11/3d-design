import * as T from 'three'

// Checks a moving tool against fixed obstacles over a program, frame by frame.
// Every triangle of the tool is tested against each obstacle, which is a box in its own frame,
// so a flat face crossing a tray is found even when none of its corners is inside.
// Not covered: motion between frames, and an obstacle wholly swallowed by a closed tool part.

// Boxes are shrunk by this much, so surfaces that only touch do not count.
const tolerance = 0.001

// A box-shaped obstacle: a BoxGeometry mesh, tested exactly in its own frame.
export function boxObstacle(name, mesh) {
  const { width, height, depth } = mesh.geometry.parameters
  return { name, frame: mesh, half: new T.Vector3(width / 2, height / 2, depth / 2), center: new T.Vector3() }
}

// The bounding box of every mesh under node, in node's own frame, as an obstacle.
export function nodeObstacle(name, node) {
  node.updateWorldMatrix(true, true)
  const inverse = new T.Matrix4().copy(node.matrixWorld).invert()
  const box = new T.Box3()
  const relative = new T.Matrix4()
  node.traverse((child) => {
    if (!child.isMesh || child.userData.hitArea) return
    child.geometry.computeBoundingBox()
    box.union(child.geometry.boundingBox.clone().applyMatrix4(relative.multiplyMatrices(inverse, child.matrixWorld)))
  })
  return { name, frame: node, half: box.getSize(new T.Vector3()).multiplyScalar(0.5), center: box.getCenter(new T.Vector3()) }
}

// A tool mesh ready for testing: its triangles' corners and bounding sphere in its own frame.
function prepare(mesh) {
  const { attributes: { position }, index } = mesh.geometry
  const corners = Array.from({ length: position.count }, (_, at) => new T.Vector3().fromBufferAttribute(position, at))
  const order = index ? Array.from(index.array) : corners.map((_, at) => at)
  return { mesh, corners, order, sphere: new T.Sphere().setFromPoints(corners), moved: corners.map(() => new T.Vector3()) }
}

const triangle = new T.Triangle()
function anyTriangleInside({ corners, order, moved }, box, matrix) {
  for (let at = 0; at < corners.length; at++) moved[at].copy(corners[at]).applyMatrix4(matrix)
  for (let at = 0; at + 2 < order.length; at += 3) {
    triangle.set(moved[order[at]], moved[order[at + 1]], moved[order[at + 2]])
    if (box.intersectsTriangle(triangle)) return true
  }
  return false
}

// movers: [{ label, meshes }]. setFrame(frame) poses the scene. floorY is the floor height in world units.
// Returns [{ from, to, what, with }] for every run of consecutive colliding frames.
export function checkClearance({ root, movers, obstacles, floorY, frames, setFrame }) {
  const tools = movers.flatMap(({ label, meshes }) => meshes.filter((mesh) => mesh.geometry.attributes.position?.count)
    .map((mesh) => ({ label, ...prepare(mesh) })))
  const targets = obstacles.map(({ name, frame, half, center }) => {
    const inner = half.clone().subScalar(tolerance).max(new T.Vector3())
    return { name, frame, box: new T.Box3(center.clone().sub(inner), center.clone().add(inner)), inverse: new T.Matrix4() }
  })
  const world = new T.Vector3()
  const sphere = new T.Sphere()
  const matrix = new T.Matrix4()
  const hits = []
  for (let frame = 0; frame <= frames; frame++) {
    setFrame(frame)
    root.updateMatrixWorld(true)
    for (const target of targets) target.inverse.copy(target.frame.matrixWorld).invert()
    const found = new Set()
    for (const tool of tools) {
      sphere.copy(tool.sphere).applyMatrix4(tool.mesh.matrixWorld)
      const lowest = floorY - tolerance
      if (sphere.center.y - sphere.radius < lowest &&
        tool.corners.some((corner) => world.copy(corner).applyMatrix4(tool.mesh.matrixWorld).y < lowest)) found.add(tool.label + '\u0000Floor')
      for (const target of targets) {
        const key = tool.label + '\u0000' + target.name
        if (found.has(key)) continue
        matrix.multiplyMatrices(target.inverse, tool.mesh.matrixWorld)
        // Most pairs are far apart: compare the tool's bounding sphere with the box first.
        if (!target.box.intersectsSphere(sphere.copy(tool.sphere).applyMatrix4(matrix))) continue
        if (anyTriangleInside(tool, target.box, matrix)) found.add(key)
      }
    }
    for (const key of found) hits.push({ frame, key })
  }
  return mergeHits(hits)
}

// Joins hits on consecutive frames into intervals, ordered by start frame.
export function mergeHits(hits) {
  const open = new Map()
  const intervals = []
  for (const { frame, key } of [...hits].sort((a, b) => a.frame - b.frame)) {
    const run = open.get(key)
    if (run && run.to === frame - 1) run.to = frame
    else {
      const [what, other] = key.split('\u0000')
      const next = { from: frame, to: frame, what, with: other }
      open.set(key, next)
      intervals.push(next)
    }
  }
  return intervals.sort((a, b) => a.from - b.from || a.what.localeCompare(b.what))
}
