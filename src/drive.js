import * as T from 'three'

export const driveLayers = [
  { id: 'motor', name: 'Servo motor', color: '#e49a61', detail: 'Rotor, shaft, laminations and copper windings' },
  { id: 'gearbox', name: 'Gear reducer', color: '#a2bfd1', detail: 'Sun gear, three planet gears and a toothed ring' },
  { id: 'wiring', name: 'Wiring harness', color: '#66c9cf', detail: 'Power and signal leads with plugs and a strain relief' },
]

const statorCount = 12
const coilCount = 4
const planetCount = 3
const leadNames = ['Power +', 'Power return', 'Encoder A', 'Encoder B']
const range = (count, make) => Array.from({ length: count }, (_, index) => make(index + 1))

// Static parts tree. The viewport, parts list and project validation all share these ids.
export const driveTree = driveLayers.map((layer) => ({ ...layer, children: {
  motor: [
    { id: 'motor-shaft', name: 'Motor shaft' },
    { id: 'motor-rotor', name: 'Rotor' },
    { id: 'motor-plate-rear', name: 'Rear end plate' },
    { id: 'motor-plate-front', name: 'Front end plate' },
    ...range(statorCount, (n) => ({ id: 'motor-stator-' + n, name: 'Stator segment ' + n, children: [
      { id: 'motor-stator-' + n + '-core', name: 'Lamination stack' },
      ...range(coilCount, (k) => ({ id: 'motor-stator-' + n + '-coil-' + k, name: 'Winding ' + k })),
    ] })),
  ],
  gearbox: [
    { id: 'gear-ring', name: 'Ring gear' },
    { id: 'gear-sun', name: 'Sun gear' },
    ...range(planetCount, (n) => ({ id: 'gear-planet-' + n, name: 'Planet set ' + n, children: [
      { id: 'gear-planet-' + n + '-gear', name: 'Planet gear ' + n },
      { id: 'gear-planet-' + n + '-pin', name: 'Planet pin ' + n },
    ] })),
  ],
  wiring: [
    ...leadNames.map((name, index) => ({ id: 'wire-lead-' + (index + 1), name: name + ' lead' })),
    { id: 'wire-plug-motor', name: 'Motor plug' },
    { id: 'wire-plug-feedback', name: 'Feedback plug' },
    { id: 'wire-strain-relief', name: 'Cable strain relief' },
  ],
}[layer.id] }))

function indexTree(nodes, parents = []) {
  return nodes.flatMap((node) => [[node.id, { ...node, parents }], ...indexTree(node.children ?? [], [...parents, node.id])])
}

export const driveIndex = Object.fromEntries(indexTree(driveTree))
export const driveIds = Object.keys(driveIndex)
export const drivePieceCount = Object.values(driveIndex).filter((node) => !node.children).length

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
  const nodes = {}
  // Each exploded node moves from its assembled position along its own offset.
  const layerMoves = []
  const pieceMoves = []
  function register(object, id, moves, offset) {
    object.name = driveIndex[id].name
    object.userData.drive = id
    nodes[id] = object
    if (offset) moves.push({ object, base: object.position.clone(), offset: new T.Vector3(...offset) })
    return object
  }
  function assembly(parent, id, moves, offset) {
    const group = new T.Group()
    parent.add(group)
    return register(group, id, moves, offset)
  }
  const piece = (object, id, offset) => register(object, id, pieceMoves, offset)
  const layerOffsets = { motor: [0, 0, -0.046], gearbox: [0, 0, 0.082], wiring: [0.075, 0, 0] }
  const groups = Object.fromEntries(driveLayers.map(({ id }) => [id, assembly(root, id, layerMoves, layerOffsets[id])]))

  const steel = metal('#8198a6')
  const brushed = metal('#c5d3dc', 0.7, 0.28)
  const dark = metal('#313e4a', 0.36, 0.42)
  const copper = metal('#df793e', 0.5, 0.34)
  const hub = metal('#b08854', 0.55, 0.37)
  const insulation = metal('#243745', 0.04, 0.65)
  const { motor, gearbox, wiring } = groups

  piece(cylinder(motor, '', 0.0082, 0.102, brushed, 0, 0, -0.013), 'motor-shaft', [0, 0, -0.15])
  piece(cylinder(motor, '', 0.028, 0.057, dark, 0, 0, -0.027), 'motor-rotor', [0, 0, -0.06])
  for (const [id, z, move] of [['motor-plate-rear', -0.056, -0.2], ['motor-plate-front', 0.001, 0.035]]) {
    const shape = new T.Shape()
    const hole = new T.Path()
    circle(shape, 0.058)
    circle(hole, 0.018)
    shape.holes.push(hole)
    piece(mesh(motor, '', new T.ExtrudeGeometry(shape, { depth: 0.005, bevelEnabled: false }), steel, 0, 0, z), id, [0, 0, move])
  }
  const lamination = new T.BoxGeometry(0.009, 0.019, 0.051)
  const winding = new T.TorusGeometry(0.009, 0.0021, 8, 30)
  for (let index = 0; index < statorCount; index++) {
    const angle = index * Math.PI * 2 / statorCount
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const x = cos * 0.044
    const y = sin * 0.044
    const id = 'motor-stator-' + (index + 1)
    const segment = assembly(motor, id, pieceMoves, [cos * 0.045, sin * 0.045, 0])
    piece(mesh(segment, '', lamination, dark, x, y, -0.024), id + '-core').rotation.z = angle
    for (let loop = 0; loop < coilCount; loop++) {
      const spread = (loop - (coilCount - 1) / 2) * 0.012
      piece(mesh(segment, '', winding, copper, x, y, -0.048 + loop * 0.014), id + '-coil-' + (loop + 1),
        [cos * 0.026, sin * 0.026, spread]).rotation.z = angle
    }
  }

  piece(mesh(gearbox, '', wheel(0.062, 0.050, 0.023, 46, true), steel, 0, 0, 0.008), 'gear-ring', [0, 0, 0.075])
  piece(mesh(gearbox, '', wheel(0.0184, 0.0065, 0.018, 14), hub, 0, 0, 0.01), 'gear-sun', [0, 0, -0.02])
  const planetGeometry = wheel(0.0207, 0.0045, 0.018, 16)
  for (let planet = 0; planet < planetCount; planet++) {
    const angle = planet * Math.PI * 2 / planetCount + Math.PI / 6
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const x = cos * 0.0345
    const y = sin * 0.0345
    const id = 'gear-planet-' + (planet + 1)
    const set = assembly(gearbox, id, pieceMoves, [cos * 0.05, sin * 0.05, 0.02])
    piece(mesh(set, '', planetGeometry, brushed, x, y, 0.01), id + '-gear').rotation.z = angle
    piece(cylinder(set, '', 0.0044, 0.026, dark, x, y, 0.019), id + '-pin', [0, 0, 0.04])
  }

  const colors = ['#e97a59', '#eec36a', '#50bec8', '#80a5f3']
  colors.forEach((color, index) => {
    const offset = (index - 1.5) * 0.0038
    const points = [[0.035 + offset, -0.05, -0.05], [0.058 + offset, -0.052, -0.037],
      [0.074 + offset, -0.015, -0.008], [0.071 + offset, 0.029, 0.009],
      [0.052 + offset, 0.062, 0.033], [0.023 + offset, 0.065, 0.035]]
    const curve = new T.CatmullRomCurve3(points.map((point) => new T.Vector3(...point)))
    piece(mesh(wiring, '', new T.TubeGeometry(curve, 36, 0.00165, 10, false), metal(color, 0.03, 0.48)),
      'wire-lead-' + (index + 1), [(index - 1.5) * 0.014, 0, 0])
  })
  piece(mesh(wiring, '', new T.BoxGeometry(0.023, 0.016, 0.014), insulation, 0.033, -0.053, -0.052), 'wire-plug-motor', [0, -0.03, -0.02])
  piece(mesh(wiring, '', new T.BoxGeometry(0.025, 0.016, 0.014), insulation, 0.021, 0.064, 0.036), 'wire-plug-feedback', [0, 0.03, 0.02])
  const clamp = piece(cylinder(wiring, '', 0.011, 0.009, insulation, 0.072, 0.018, 0.008), 'wire-strain-relief', [0.035, 0, 0])
  clamp.quaternion.setFromUnitVectors(up, new T.Vector3(-0.12, 0.9, 0.25).normalize())

  let separation = 0
  function attach(pivot, index, amount) {
    pivot.add(root)
    root.scale.setScalar(jointSizes[index])
    root.position.set(0, 0, 0)
    separate(amount)
  }

  const ease = (value) => value * value * (3 - 2 * value)
  // The first half of the slider parts the three subassemblies, the second half spreads every piece.
  function separate(amount) {
    separation = amount
    const layer = ease(T.MathUtils.clamp(amount / 0.55, 0, 1))
    const pieces = ease(T.MathUtils.clamp((amount - 0.45) / 0.55, 0, 1))
    for (const { object, base, offset } of layerMoves) object.position.copy(base).addScaledVector(offset, layer)
    for (const { object, base, offset } of pieceMoves) object.position.copy(base).addScaledVector(offset, pieces)
  }

  // Clone the drive fully assembled, whatever the current separation.
  function assembledClone() {
    const current = separation
    separate(0)
    const copy = root.clone()
    separate(current)
    return copy
  }

  return { root, groups, nodes, attach, separate, assembledClone }
}
