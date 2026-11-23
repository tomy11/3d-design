import * as T from 'three'

// Numerical inverse kinematics by damped least squares. The robot is a black box: pose(angles)
// returns the world matrix of the frame to place, so this works for any serial arm the scene holds.
// Angles are in degrees, as the robot model takes them.

const step = 1e-3 // degrees, for the numerical Jacobian
const positionTolerance = 1e-6 // metres (0.001 mm)
const rotationTolerance = 1e-5 // radians

const position = new T.Vector3()
const targetPosition = new T.Vector3()
const rotation = new T.Quaternion()
const targetRotation = new T.Quaternion()
const scale = new T.Vector3()
const delta = new T.Quaternion()

// Position error in metres and rotation error as an axis-angle vector in radians.
function poseError(matrix, target) {
  matrix.decompose(position, rotation, scale)
  target.decompose(targetPosition, targetRotation, scale)
  delta.copy(targetRotation).multiply(rotation.clone().invert())
  if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w)
  const half = Math.acos(Math.min(1, delta.w))
  const factor = half < 1e-9 ? 2 : 2 * half / Math.sin(half)
  return [
    targetPosition.x - position.x, targetPosition.y - position.y, targetPosition.z - position.z,
    delta.x * factor, delta.y * factor, delta.z * factor,
  ]
}

// Solves the square system a x = b in place by Gaussian elimination with partial pivoting.
export function solveLinear(a, b) {
  const n = b.length
  const m = a.map((row, index) => [...row, b[index]])
  for (let column = 0; column < n; column++) {
    let pivot = column
    for (let row = column + 1; row < n; row++) if (Math.abs(m[row][column]) > Math.abs(m[pivot][column])) pivot = row
    ;[m[column], m[pivot]] = [m[pivot], m[column]]
    const lead = m[column][column] || 1e-12
    for (let row = 0; row < n; row++) {
      if (row === column) continue
      const factor = m[row][column] / lead
      for (let k = column; k <= n; k++) m[row][k] -= factor * m[column][k]
    }
  }
  return m.map((row, index) => row[n] / (row[index] || 1e-12))
}

// Finds angles near start that put pose(angles) on target (a Matrix4).
// limits are ± degrees per joint. Returns { angles, position, rotation, converged } with the
// remaining position error in metres and rotation error in radians.
export function solvePose({ pose, start, target, limits, iterations = 200, damping = 0.02 }) {
  let angles = [...start]
  const clamp = (values) => values.map((value, index) => T.MathUtils.clamp(value, -limits[index], limits[index]))
  const measure = (values) => {
    const error = poseError(pose(values), target)
    return { error, position: Math.hypot(error[0], error[1], error[2]), rotation: Math.hypot(error[3], error[4], error[5]) }
  }
  let current = measure(angles)
  for (let iteration = 0; iteration < iterations; iteration++) {
    if (current.position < positionTolerance && current.rotation < rotationTolerance) break
    // Jacobian columns: how the 6-vector error changes per radian of each joint. Radians keep its
    // entries near 1 (metres and radians), so the damping term stays small beside them.
    const radians = T.MathUtils.degToRad(step)
    const jacobian = angles.map((_, joint) => {
      const nudged = [...angles]
      nudged[joint] += step
      const error = poseError(pose(nudged), target)
      return error.map((value, row) => (current.error[row] - value) / radians)
    })
    // Damped least squares: dq = Jᵀ (J Jᵀ + λ² I)⁻¹ e, with J as 6 rows by n joints.
    const rows = 6
    const jjt = Array.from({ length: rows }, (_, i) => Array.from({ length: rows }, (_, j) =>
      jacobian.reduce((sum, column) => sum + column[i] * column[j], 0) + (i === j ? damping * damping : 0)))
    const y = solveLinear(jjt, current.error)
    const change = jacobian.map((column) => T.MathUtils.radToDeg(column.reduce((sum, value, row) => sum + value * y[row], 0)))
    // Never jump more than 10° in one step, so the solution stays on the same arm configuration.
    const largest = Math.max(...change.map(Math.abs))
    const limit = largest > 10 ? 10 / largest : 1
    const next = clamp(angles.map((value, index) => value + change[index] * limit))
    const measured = measure(next)
    if (measured.position + measured.rotation > current.position + current.rotation && damping < 10) {
      damping *= 4
      continue
    }
    angles = next
    current = measured
    damping = Math.max(1e-4, damping / 2)
  }
  return {
    angles: angles.map((value) => Math.round(value * 1e6) / 1e6),
    position: current.position, rotation: current.rotation,
    converged: current.position < 1e-5 && current.rotation < 1e-4,
  }
}
