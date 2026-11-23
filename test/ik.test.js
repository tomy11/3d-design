import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as T from 'three'
import { solveLinear, solvePose } from '../src/ik.js'

// A UR-like six-joint arm: each joint turns about its local Z, with offsets and quarter turns between.
function makeArm() {
  const root = new T.Group()
  const links = [
    [[0, 0, 0.18], [0, 0, 0]], [[0, 0, 0], [Math.PI / 2, 0, 0]], [[-0.61, 0, 0], [0, 0, 0]],
    [[-0.57, 0, 0.17], [0, 0, 0]], [[0, -0.12, 0], [Math.PI / 2, 0, 0]], [[0, 0.12, 0], [-Math.PI / 2, 0, 0]],
  ]
  let parent = root
  const pivots = links.map(([offset, turn]) => {
    const mount = new T.Group()
    mount.position.set(...offset)
    mount.rotation.set(...turn)
    const pivot = new T.Group()
    mount.add(pivot)
    parent.add(mount)
    parent = pivot
    return pivot
  })
  const tool = new T.Group()
  tool.position.z = 0.1
  parent.add(tool)
  return {
    pose(angles) {
      pivots.forEach((pivot, index) => { pivot.rotation.z = T.MathUtils.degToRad(angles[index]) })
      root.updateMatrixWorld(true)
      return tool.matrixWorld.clone()
    },
  }
}

test('solveLinear solves a small system', () => {
  const x = solveLinear([[2, 1, 0], [1, 3, 1], [0, 1, 4]], [3, 10, 13])
  const check = [[2, 1, 0], [1, 3, 1], [0, 1, 4]].map((row) => row.reduce((sum, value, index) => sum + value * x[index], 0))
  check.forEach((value, index) => assert.ok(Math.abs(value - [3, 10, 13][index]) < 1e-9))
})

test('solvePose reaches a pose another set of angles makes', () => {
  const arm = makeArm()
  const goal = [20, -70, 95, -110, -85, 30]
  const target = arm.pose(goal)
  const result = solvePose({ pose: arm.pose, start: [12, -60, 85, -100, -90, 20], target, limits: Array(6).fill(360) })
  assert.ok(result.converged, 'position error ' + result.position + ' rotation error ' + result.rotation)
  const reached = arm.pose(result.angles)
  assert.ok(new T.Vector3().setFromMatrixPosition(reached).distanceTo(new T.Vector3().setFromMatrixPosition(target)) < 1e-5)
})

test('solvePose moves a longer tool back onto the same point', () => {
  const arm = makeArm()
  const start = [10, -80, 100, -110, -90, 0]
  // Target: the tip of a tool 12 mm longer must land where the original tip was.
  const target = arm.pose(start)
  const longer = (angles) => arm.pose(angles).multiply(new T.Matrix4().makeTranslation(0, 0, 0.012))
  const result = solvePose({ pose: longer, start, target, limits: Array(6).fill(360) })
  assert.ok(result.converged)
  assert.ok(Math.max(...result.angles.map((value, index) => Math.abs(value - start[index]))) < 10, 'stays near the start configuration')
})

test('solvePose respects joint limits', () => {
  const arm = makeArm()
  const target = arm.pose([0, -90, 150, -90, -90, 0])
  const result = solvePose({ pose: arm.pose, start: [0, -90, 100, -90, -90, 0], target, limits: [360, 360, 120, 360, 360, 360] })
  assert.ok(Math.abs(result.angles[2]) <= 120)
})

// The UR10e's own kinematic chain (as src/robot.js builds it), without meshes.
function makeUr10e() {
  const identity = [0, 0, 0]
  const origins = [
    [[0, 0, 0.1807], identity], [[0, 0, 0], [1.570796327, 0, 0]], [[-0.6127, 0, 0], identity],
    [[-0.57155, 0, 0.17415], identity], [[0, -0.11985, 0], [1.570796327, 0, 0]], [[0, 0.11655, 0], [1.570796326589793, Math.PI, Math.PI]],
  ]
  const group = (parent) => { const child = new T.Group(); parent.add(child); return child }
  const apply = (object, [position, rpy]) => { object.position.set(...position); object.rotation.set(...rpy, 'ZYX') }
  const root = new T.Group()
  const basis = group(root)
  basis.rotation.x = -Math.PI / 2
  let parent = group(basis)
  parent.rotation.z = Math.PI
  const pivots = origins.map((origin) => {
    const mount = group(parent)
    apply(mount, origin)
    const pivot = group(mount)
    parent = group(pivot)
    return pivot
  })
  const flange = group(parent)
  apply(flange, [identity, [0, -Math.PI / 2, -Math.PI / 2]])
  const tool = group(flange)
  apply(tool, [identity, [Math.PI / 2, 0, Math.PI / 2]])
  return (angles) => {
    pivots.forEach((pivot, index) => { pivot.rotation.z = T.MathUtils.degToRad(angles[index]) })
    root.updateMatrixWorld(true)
    return tool.matrixWorld.clone()
  }
}

test('on the UR10e, steps along the tool axis converge quickly', () => {
  const pose = makeUr10e()
  const start = [-2.1, -74.5, 109.4, -64.3, 59.8, 23.6]
  for (const [x, y, z] of [[0, 0, 0.01], [0, 0, -0.05], [0.02, 0, 0], [0, -0.03, 0]]) {
    const target = pose(start).multiply(new T.Matrix4().makeTranslation(x, y, z))
    const result = solvePose({ pose, start, target, limits: [360, 360, 160, 360, 360, 360], iterations: 30 })
    assert.ok(result.converged, 'tool step ' + [x, y, z] + ' left ' + result.position + ' m')
  }
})
