import * as T from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'

export const sourceUrl = 'https://github.com/UniversalRobots/Universal_Robots_ROS2_Description/tree/0eb1a861f7772fceb38510d90fa2f98ec668070c/meshes/ur10e'
export const licenseUrl = import.meta.env.BASE_URL + 'models/ur10e-license.txt'

const rad = T.MathUtils.degToRad
const axis = new T.Vector3(0, 0, 1)
const identity = [0, 0, 0]

// Nominal kinematics and visual offsets from the manufacturer's UR10e ROS 2 description.
// Translation is in metres. URDF rotations use fixed-axis roll, pitch and yaw.
const links = [
  { id: 'base', name: 'Base', visual: [[0, 0, 0], [0, 0, Math.PI]], parts: ['010', '001'] },
  { id: 'shoulder', name: 'Shoulder', joint: 'J1', limit: 360, origin: [[0, 0, 0.1807], identity], visual: [[0, 0, 0], [0, 0, Math.PI]], parts: ['023', '002', '003'] },
  { id: 'upperarm', name: 'Upper Arm', joint: 'J2', limit: 360, origin: [[0, 0, 0], [1.570796327, 0, 0]], visual: [[0, 0, 0.1762], [Math.PI / 2, 0, -Math.PI / 2]], parts: ['028', '004', '005', '007', '008', '009', '011', '014'] },
  { id: 'forearm', name: 'Forearm', joint: 'J3', limit: 160, origin: [[-0.6127, 0, 0], identity], visual: [[0, 0, 0.0393], [Math.PI / 2, 0, -Math.PI / 2]], parts: ['031', '015', '016', '017', '018', '019', '020'] },
  { id: 'wrist1', name: 'Wrist 1', joint: 'J4', limit: 360, origin: [[-0.57155, 0, 0.17415], identity], visual: [[0, 0, -0.135], [Math.PI / 2, 0, 0]], parts: ['037', '021', '022'] },
  { id: 'wrist2', name: 'Wrist 2', joint: 'J5', limit: 360, origin: [[0, -0.11985, -2.458164590756244e-11], [1.570796327, 0, 0]], visual: [[0, 0, -0.12], identity], parts: ['040', '030', '035'] },
  { id: 'wrist3', name: 'Tool Flange', joint: 'J6', limit: 360, origin: [[0, 0.11655, -2.390480459346185e-11], [1.570796326589793, Math.PI, Math.PI]], visual: [[0, -0.0005, -0.1168], [Math.PI / 2, 0, 0]], parts: ['042'] },
]

export const joints = links.filter((link) => link.joint)
export const meshCount = links.reduce((count, link) => count + link.parts.length, 0)
export const hierarchy = [{
  id: 'robot', name: 'UR10e', children: links.map(({ id, name, joint, limit, parts }) => ({
    id, name, joint, limit, children: parts.map((part) => ({ id: 'cad' + part, name: 'CAD ' + part, sourceName: 'eSeries_UR10e_' + part })),
  })),
}]

export const keyframes = [
  { frame: 0, name: 'Inspection home', angles: [0, -70, 104, -60, 75, 15] },
  { frame: 30, name: 'Shoulder sweep', angles: [35, -86, 100, -58, 86, 35] },
  { frame: 60, name: 'Wrist articulation', angles: [25, -74, 80, -28, 27, 94] },
  { frame: 90, name: 'Reach and retract', angles: [-23, -59, 105, -81, 65, -45] },
  { frame: 120, name: 'Return home', angles: [0, -70, 104, -60, 75, 15] },
]

function group(parent, name) {
  const object = new T.Group()
  object.name = name
  parent.add(object)
  return object
}

function applyOrigin(object, [position, rpy]) {
  object.position.set(...position)
  object.rotation.set(...rpy, 'ZYX')
}

export async function loadRobot() {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const { scene: assets } = await loader.loadAsync(import.meta.env.BASE_URL + 'models/ur10e.glb')
  const plant = new T.Group()
  plant.name = 'Universal_Robots_UR10e'
  plant.userData = { source: sourceUrl, license: 'BSD-3-Clause' }
  const objects = { robot: plant }
  const basis = group(plant, 'URDF_Z_up')
  basis.rotation.x = -Math.PI / 2
  const baseInertia = group(basis, 'base_link_inertia')
  baseInertia.rotation.z = Math.PI
  let parent = baseInertia
  const pivots = []
  const visuals = []

  for (const [index, link] of links.entries()) {
    if (link.origin) {
      const origin = group(parent, link.id + '_origin')
      applyOrigin(origin, link.origin)
      parent = group(origin, link.id + '_joint')
      pivots.push(parent)
    }
    const object = group(parent, link.id + '_link')
    objects[link.id] = object
    const display = group(object, link.id + '_presentation')
    const asset = assets.getObjectByName(link.id)
    if (!asset) throw new Error('Missing UR10e link ' + link.id)
    applyOrigin(asset, link.visual)
    display.add(asset)

    const boxes = new Map()
    const assemblyBounds = new T.Box3()
    asset.updateWorldMatrix(true, true)
    const inverse = asset.matrixWorld.clone().invert()
    for (const id of link.parts) {
      const name = 'eSeries_UR10e_' + id
      const mesh = asset.getObjectByName(name)
      if (!mesh) throw new Error('Missing UR10e CAD part ' + name)
      const part = group(asset, name + '_presentation')
      const bounds = new T.Box3()
      mesh.traverse((child) => {
        if (!child.isMesh) return
        child.castShadow = true
        child.receiveShadow = true
        child.geometry.computeBoundingBox()
        const transform = inverse.clone().multiply(child.matrixWorld)
        bounds.union(child.geometry.boundingBox.clone().applyMatrix4(transform))
      })
      const selectable = group(part, name + '_component')
      const pivot = bounds.getCenter(new T.Vector3())
      selectable.position.copy(pivot)
      mesh.position.sub(pivot)
      selectable.add(mesh)
      objects['cad' + id] = selectable
      boxes.set(part, bounds)
      assemblyBounds.union(bounds)
    }
    const center = assemblyBounds.getCenter(new T.Vector3())
    const components = [...boxes].map(([node, bounds], partIndex) => {
      const direction = bounds.getCenter(new T.Vector3()).sub(center)
      if (direction.lengthSq() < 0.000004) direction.set(Math.cos(partIndex * 2.4), Math.sin(partIndex * 2.4), 0.3)
      const gap = boxes.size === 1 ? 0 : 0.052 + (partIndex % 3) * 0.016
      return { node, direction: direction.normalize().multiplyScalar(gap) }
    })
    visuals.push({ id: link.id, node: display, index, components })
    parent = object
  }
  for (const [id, object] of Object.entries(objects)) object.userData.part = id
  const flange = group(objects.wrist3, 'flange')
  applyOrigin(flange, [identity, [0, -Math.PI / 2, -Math.PI / 2]])
  const tool = group(flange, 'tool0')
  applyOrigin(tool, [identity, [Math.PI / 2, 0, Math.PI / 2]])

  function setAngles(angles) {
    for (const [index, pivot] of pivots.entries()) {
      const limit = joints[index].limit
      pivot.rotation.z = rad(T.MathUtils.clamp(angles[index], -limit, limit))
    }
  }

  const gap = new T.Vector3()
  const offset = new T.Vector3()
  const worldRotation = new T.Quaternion()
  function separate(amount) {
    plant.updateWorldMatrix(true, true)
    for (const { node, index, components } of visuals) {
      // Keep the posing chain intact and offset only the rendered parts.
      gap.set(index * 0.092, index * 0.073, index * -0.027).multiplyScalar(amount)
      offset.copy(gap).applyQuaternion(plant.getWorldQuaternion(worldRotation))
      node.parent.worldToLocal(offset.add(node.parent.getWorldPosition(gap)))
      node.position.copy(offset)
      for (const { node: component, direction } of components) component.position.copy(direction).multiplyScalar(amount)
    }
  }

  return { plant, objects, pivots, visuals, tool, basis, setAngles, separate }
}

export function makeMotionClip(pivots, name, end, sample) {
  const times = Array.from({ length: end + 1 }, (_, frame) => frame / 30)
  const poses = times.map((_, frame) => sample(frame))
  const orientation = new T.Quaternion()
  const tracks = pivots.map((pivot, index) => {
    const values = poses.flatMap((angles) => orientation.setFromAxisAngle(axis, rad(angles[index])).toArray())
    return new T.QuaternionKeyframeTrack(pivot.name + '.quaternion', times, values)
  })
  return new T.AnimationClip(name, end / 30, tracks)
}
