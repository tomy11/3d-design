import * as T from 'three'

// Checks a moving tool against fixed obstacles over a program, frame by frame.
// The tool is sampled as points (its mesh vertices), and each obstacle is a box in its own
// frame, so the check is conservative to within the sampling and the tolerance.

const tolerance = 0.001
const pointsPerMesh = 1500

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

// Up to pointsPerMesh vertices of each mesh, in the mesh's own frame.
function samplePoints(meshes) {
  return meshes.map((mesh) => {
    const position = mesh.geometry.attributes.position
    const stride = Math.max(1, Math.ceil(position.count / pointsPerMesh))
    const points = []
    for (let index = 0; index < position.count; index += stride) points.push(new T.Vector3().fromBufferAttribute(position, index))
    return { mesh, points }
  })
}

// movers: [{ label, meshes }]. setFrame(frame) poses the scene. floorY is the floor height in world units.
// Returns [{ from, to, what, with }] for every run of consecutive colliding frames.
export function checkClearance({ root, movers, obstacles, floorY, frames, setFrame }) {
  const sampled = movers.map(({ label, meshes }) => ({ label, parts: samplePoints(meshes.filter((mesh) => mesh.geometry.attributes.position?.count)) }))
  const world = new T.Vector3()
  const local = new T.Vector3()
  const inverses = obstacles.map(() => new T.Matrix4())
  const hits = []
  for (let frame = 0; frame <= frames; frame++) {
    setFrame(frame)
    root.updateMatrixWorld(true)
    obstacles.forEach((obstacle, index) => inverses[index].copy(obstacle.frame.matrixWorld).invert())
    const found = new Set()
    for (const { label, parts } of sampled) {
      for (const { mesh, points } of parts) {
        for (const point of points) {
          world.copy(point).applyMatrix4(mesh.matrixWorld)
          if (world.y < floorY - tolerance) found.add(label + '\u0000Floor')
          obstacles.forEach((obstacle, index) => {
            local.copy(world).applyMatrix4(inverses[index]).sub(obstacle.center)
            if (Math.abs(local.x) < obstacle.half.x - tolerance && Math.abs(local.y) < obstacle.half.y - tolerance &&
              Math.abs(local.z) < obstacle.half.z - tolerance) found.add(label + '\u0000' + obstacle.name)
          })
        }
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
