import * as T from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { fps, gripAt, pickProgram } from './program'

export const gripperSource = 'https://github.com/robotiq/robotiq-ros/tree/f9da2317ff6a3576599201d58470d9eaf7afbecb/grippers/robotiq_description'
export const gripperLicense = import.meta.env.BASE_URL + 'models/robotiq-license.txt'
export const pinchOffset = 0.1325
const halfBlock = 0.015

function box(parent, name, size, material, x, y, z) {
  const object = new T.Mesh(new T.BoxGeometry(...size), material)
  object.name = name
  object.position.set(x, y, z)
  object.castShadow = object.receiveShadow = true
  parent.add(object)
  return object
}

function material(color, metalness = 0.2) {
  return new T.MeshStandardMaterial({ color, metalness, roughness: 0.40 })
}

// Returns the tray's solid boxes, for clearance checks.
function makeTray(scene, id, color, location) {
  const tray = new T.Group()
  tray.name = 'Tray_' + id
  tray.position.set(location.x, 0, location.z)
  scene.add(tray)
  const graphite = material('#2a3643', 0.43)
  const accent = material(color, 0.30)
  const top = location.y - halfBlock
  const solids = [
    box(tray, 'Tray body', [0.158, top - 0.006, 0.14], graphite, 0, top / 2 - 0.003, 0),
    box(tray, 'Tray top', [0.160, 0.006, 0.142], graphite, 0, top - 0.003, 0),
  ]
  for (const x of [-0.074, 0.074]) box(tray, 'Tray side stripe', [0.005, 0.001, 0.13], accent, x, top, 0)
  for (const z of [-0.062, 0.062]) box(tray, 'Tray end stripe', [0.143, 0.001, 0.005], accent, 0, top, z)
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 48
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 128, 48)
  ctx.font = '700 31px monospace'
  ctx.fillStyle = '#19232d'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(id === 'A' ? 'A / PICK' : 'B / PLACE', 64, 25)
  const texture = new T.CanvasTexture(canvas)
  texture.colorSpace = T.SRGBColorSpace
  const label = new T.Mesh(new T.PlaneGeometry(0.108, 0.032), new T.MeshBasicMaterial({ map: texture }))
  label.rotation.x = -Math.PI / 2
  label.position.set(0, top + 0.001, 0.039)
  tray.add(label)
  return solids.map((mesh) => ({ name: 'Tray ' + id, mesh }))
}

export async function loadGripper() {
  return (await new GLTFLoader().loadAsync(import.meta.env.BASE_URL + 'models/robotiq-hand-e.glb')).scene
}

export function makePickCell(robot, gripper) {
  const stations = new T.Group()
  stations.name = 'Pick_and_place_station'
  robot.plant.add(stations)
  gripper.name = 'Robotiq_Hand_E'
  robot.tool.add(gripper)
  const jaws = {}
  const finish = {
    'hand-e': material('#36404a', 0.34),
    left_finger: material('#a0aeba', 0.42),
    right_finger: material('#a0aeba', 0.42),
  }
  for (const name of Object.keys(finish)) {
    gripper.getObjectByName(name).traverse((node) => {
      if (!node.isMesh) return
      const materials = Array.isArray(node.material) ? node.material : [node.material]
      for (const entry of materials) entry.dispose()
      node.material = finish[name]
      node.castShadow = node.receiveShadow = true
    })
  }
  for (const [name, direction] of [['left_finger', -1], ['right_finger', 1]]) {
    const asset = gripper.getObjectByName(name)
    const joint = new T.Group()
    joint.name = name + '_slide'
    joint.position.set(direction * 0.025, 0, 0.099)
    asset.parent.add(joint)
    joint.add(asset)
    jaws[name] = joint
  }

  // A part mounted on the flange pushes the gripper, and so the pinch point, out by its height.
  let standoff = 0
  const matrices = { matrix: new T.Matrix4(), inverse: new T.Matrix4() }
  const offset = new T.Vector3()
  const pose = { position: new T.Vector3(), rotation: new T.Quaternion(), scale: new T.Vector3() }
  function pinch() {
    robot.tool.updateWorldMatrix(true, false)
    matrices.inverse.copy(robot.plant.matrixWorld).invert()
    matrices.matrix.multiplyMatrices(matrices.inverse, robot.tool.matrixWorld)
    matrices.matrix.decompose(pose.position, pose.rotation, pose.scale)
    pose.position.add(offset.set(0, 0, pinchOffset + standoff).applyQuaternion(pose.rotation))
    return pose
  }

  const current = robot.pivots.map((joint) => T.MathUtils.radToDeg(joint.rotation.z))
  const samples = [1, 5].map((index) => {
    robot.setAngles(pickProgram[index].angles)
    const { position, rotation } = pinch()
    return { position: position.clone(), rotation: rotation.clone() }
  })
  robot.setAngles(current)
  const obstacles = [
    ...makeTray(stations, 'A', '#f0c164', samples[0].position),
    ...makeTray(stations, 'B', '#78bdce', samples[1].position),
  ]
  const part = box(stations, 'Workpiece', [halfBlock * 2, halfBlock * 2, halfBlock * 2], material('#ffb446', 0.31), 0, 0, 0)

  let currentFrame = 0
  function update(frame) {
    currentFrame = frame
    const amount = gripAt(frame)
    jaws.left_finger.position.x = -0.025 + amount
    jaws.right_finger.position.x = 0.025 - amount
    const { position, rotation } = frame < 47 ? samples[0] : frame >= 149 ? samples[1] : pinch()
    part.position.copy(position)
    part.quaternion.copy(rotation)
  }

  function setVisible(visible) {
    gripper.visible = stations.visible = visible
  }

  function setStandoff(metres) {
    standoff = metres
    gripper.position.z = metres
    update(currentFrame)
  }

  // Tints the gripper red while it collides with something.
  function setWarning(on) {
    for (const entry of Object.values(finish)) entry.emissive.set(on ? '#b3261e' : '#000000')
  }

  setVisible(false)
  update(0)
  function motionTracks(duration, sample) {
    const oldFrame = currentFrame
    const oldAngles = robot.pivots.map((joint) => T.MathUtils.radToDeg(joint.rotation.z))
    const times = Array.from({ length: duration + 1 }, (_, frame) => frame / fps)
    const targets = [jaws.left_finger, jaws.right_finger, part]
    const positions = targets.map(() => [])
    const rotations = []
    for (let frame = 0; frame <= duration; frame++) {
      robot.setAngles(sample(frame))
      update(frame)
      targets.forEach((target, index) => positions[index].push(...target.position.toArray()))
      rotations.push(...part.quaternion.toArray())
    }
    robot.setAngles(oldAngles)
    update(oldFrame)
    return [
      ...targets.map((target, index) => new T.VectorKeyframeTrack(target.name + '.position', times, positions[index])),
      new T.QuaternionKeyframeTrack(part.name + '.quaternion', times, rotations),
    ]
  }

  return { stations, gripper, obstacles, update, setVisible, setStandoff, setWarning, motionTracks }
}
