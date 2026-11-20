import * as T from 'three'

export const driveLayers = [
  { id: 'motor', name: 'Servo motor', color: '#e49a61', detail: 'Rotor, shaft, laminations and copper windings' },
  { id: 'gearbox', name: 'Gear reducer', color: '#a2bfd1', detail: 'Sun gear, three planet gears and a toothed ring' },
  { id: 'wiring', name: 'Wiring harness', color: '#66c9cf', detail: 'Power and signal leads with plugs and a strain relief' },
]

const jointSizes = [1, 1, 0.86, 0.63, 0.59, 0.55]
const up = new T.Vector3(0, 1, 0)

function metal(color, metalness = 0.55, roughness = 0.34) {
  return new T.MeshStandardMaterial({ color, metalness, roughness })
}

function mesh(parent, name, geometry, material, x = 0, y = 0, z = 0) {
  const item = new T.Mesh(geometry, material)
  item.name = name
  item.position.set(x, y, z)
  item.castShadow = true
  parent.add(item)
  return item
}

function cylinder(parent, name, radius, height, material, x, y, z) {
  const item = mesh(parent, name, new T.CylinderGeometry(radius, radius, height, 48), material, x, y, z)
  item.rotation.x = Math.PI / 2
  return item
}

function profile(outline, teeth, root, tip) {
  const count = teeth * 4
  for (let n = 0; n <= count; n++) {
    const angle = n / count * Math.PI * 2
    const radius = n % 4 === 1 || n % 4 === 2 ? tip : root
    outline[n === 0 ? 'moveTo' : 'lineTo'](radius * Math.cos(angle), radius * Math.sin(angle))
  }
  outline.closePath()
}

function circle(outline, radius) {
  outline.absarc(0, 0, radius, 0, Math.PI * 2, false)
}

function wheel(outer, inner, depth, teeth, internal = false) {
  const shape = new T.Shape()
  const hole = new T.Path()
  if (internal) {
    circle(shape, outer)
    profile(hole, teeth, inner, inner + 0.003)
  } else {
    profile(shape, teeth, outer * 0.86, outer)
    circle(hole, inner)
  }
  shape.holes.push(hole)
  return new T.ExtrudeGeometry(shape, { depth, curveSegments: 24, bevelEnabled: false })
}

export function makeDrive() {
  const root = new T.Group()
  root.name = 'Conceptual_joint_drive'
  root.userData.scope = 'Illustrative independent design. Internal UR10e dimensions and construction are not represented.'
  const groups = Object.fromEntries(driveLayers.map(({ id, name }) => {
    const group = new T.Group()
    group.name = name
    group.userData.drive = id
    root.add(group)
    return [id, group]
  }))

  const steel = metal('#8198a6')
  const brushed = metal('#c5d3dc', 0.7, 0.28)
  const dark = metal('#313e4a', 0.36, 0.42)
  const copper = metal('#df793e', 0.5, 0.34)
  const hub = metal('#b08854', 0.55, 0.37)
  const insulation = metal('#243745', 0.04, 0.65)
  const { motor, gearbox, wiring } = groups

  cylinder(motor, 'Rotor', 0.028, 0.057, dark, 0, 0, -0.027)
  cylinder(motor, 'Motor shaft', 0.0082, 0.102, brushed, 0, 0, -0.013)
  for (const z of [-0.056, 0.001]) {
    const shape = new T.Shape()
    const hole = new T.Path()
    circle(shape, 0.058)
    circle(hole, 0.018)
    shape.holes.push(hole)
    mesh(motor, 'Motor end plate', new T.ExtrudeGeometry(shape, { depth: 0.005, bevelEnabled: false }), steel, 0, 0, z)
  }
  const lamination = new T.BoxGeometry(0.009, 0.019, 0.051)
  const winding = new T.TorusGeometry(0.009, 0.0021, 8, 30)
  for (let index = 0; index < 12; index++) {
    const angle = index * Math.PI / 6
    const x = Math.cos(angle) * 0.044
    const y = Math.sin(angle) * 0.044
    mesh(motor, 'Stator pole', lamination, dark, x, y, -0.024).rotation.z = angle
    for (let loop = 0; loop < 4; loop++) {
      mesh(motor, 'Copper winding', winding, copper, x, y, -0.048 + loop * 0.014).rotation.z = angle
    }
  }

  mesh(gearbox, 'Ring gear', wheel(0.062, 0.050, 0.023, 46, true), steel, 0, 0, 0.008)
  mesh(gearbox, 'Sun gear', wheel(0.0184, 0.0065, 0.018, 14), hub, 0, 0, 0.01)
  const planetGeometry = wheel(0.0207, 0.0045, 0.018, 16)
  for (let planet = 0; planet < 3; planet++) {
    const angle = planet * Math.PI * 2 / 3 + Math.PI / 6
    const x = Math.cos(angle) * 0.0345
    const y = Math.sin(angle) * 0.0345
    mesh(gearbox, 'Planet gear ' + (planet + 1), planetGeometry, brushed, x, y, 0.01).rotation.z = angle
    cylinder(gearbox, 'Planet pin', 0.0044, 0.026, dark, x, y, 0.019)
  }

  const colors = ['#e97a59', '#eec36a', '#50bec8', '#80a5f3']
  colors.forEach((color, index) => {
    const offset = (index - 1.5) * 0.0038
    const points = [[0.035 + offset, -0.05, -0.05], [0.058 + offset, -0.052, -0.037],
      [0.074 + offset, -0.015, -0.008], [0.071 + offset, 0.029, 0.009],
      [0.052 + offset, 0.062, 0.033], [0.023 + offset, 0.065, 0.035]]
    const curve = new T.CatmullRomCurve3(points.map((point) => new T.Vector3(...point)))
    mesh(wiring, ['Power +', 'Power return', 'Encoder A', 'Encoder B'][index],
      new T.TubeGeometry(curve, 36, 0.00165, 10, false), metal(color, 0.03, 0.48))
  })
  mesh(wiring, 'Motor plug', new T.BoxGeometry(0.023, 0.016, 0.014), insulation, 0.033, -0.053, -0.052)
  mesh(wiring, 'Feedback plug', new T.BoxGeometry(0.025, 0.016, 0.014), insulation, 0.021, 0.064, 0.036)
  const clamp = cylinder(wiring, 'Cable strain relief', 0.011, 0.009, insulation, 0.072, 0.018, 0.008)
  clamp.quaternion.setFromUnitVectors(up, new T.Vector3(-0.12, 0.9, 0.25).normalize())

  function attach(pivot, index, separation) {
    pivot.add(root)
    root.scale.setScalar(jointSizes[index])
    root.position.set(0, 0, 0)
    separate(separation)
  }

  function separate(amount) {
    motor.position.z = -0.046 * amount
    gearbox.position.z = 0.082 * amount
    wiring.position.x = 0.075 * amount
  }

  return { root, groups, attach, separate }
}
