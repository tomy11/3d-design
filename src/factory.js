import * as T from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

export const hierarchy = [
  { id: 'robot', name: 'Robot Arm', children: [
    { id: 'base', name: 'Base Pedestal' },
    { id: 'shoulder', name: 'Shoulder Joint', children: [
      { id: 'upper', name: 'Upper Arm', children: [
        { id: 'elbow', name: 'Elbow Joint', children: [
          { id: 'forearm', name: 'Forearm', children: [
            { id: 'wrist', name: 'Wrist Joint', children: [{ id: 'gripper', name: 'Gripper' }] },
          ] },
        ] },
      ] },
    ] },
  ] },
  { id: 'vehicle', name: 'Vehicle', children: [
    { id: 'chassis', name: 'Chassis' },
    { id: 'body', name: 'Body Shell' },
    { id: 'wheels', name: 'Wheel Set' },
  ] },
  { id: 'platform', name: 'Assembly Platform' },
]

export const defaultOpen = ['robot', 'shoulder', 'upper', 'vehicle']

function material(color, metalness = 0.15, roughness = 0.4) {
  return new T.MeshStandardMaterial({ color, metalness, roughness })
}

const vector = (v) => new T.Vector3(...v)

export function makeFactory() {
  const plant = new T.Group()
  const objects = {}
  const yellow = material('#ffbc13', 0.32, 0.3)
  const gold = material('#ce840d', 0.32, 0.33)
  const black = material('#1e252b', 0.19, 0.38)
  const dark = material('#303941', 0.37, 0.34)
  const rubber = material('#141a1e', 0.02, 0.75)
  const steel = material('#8fa2ab', 0.61, 0.34)
  const light = material('#c3d3d8', 0.43, 0.31)
  const blue = material('#48788d', 0.46, 0.27)
  const blueTrim = material('#304d5d', 0.43, 0.31)
  const glass = material('#172d3b', 0.49, 0.16)
  const whiteLamp = new T.MeshStandardMaterial({ color: '#cbf4ff', emissive: '#89d7fc', emissiveIntensity: 0.7 })
  const redLamp = new T.MeshStandardMaterial({ color: '#d95540', emissive: '#fb3f21', emissiveIntensity: 0.55 })

  function group(parent, id, position = [0, 0, 0]) {
    const object = new T.Group()
    object.name = id
    object.position.set(...position)
    if (id) {
      object.userData.part = id
      objects[id] = object
    }
    parent.add(object)
    return object
  }

  function mesh(parent, geometry, surface, position = [0, 0, 0]) {
    const object = new T.Mesh(geometry, surface)
    object.position.set(...position)
    object.castShadow = true
    object.receiveShadow = true
    parent.add(object)
    return object
  }

  function box(parent, dimensions, position, surface, radius = 0.03) {
    return mesh(parent, new RoundedBoxGeometry(...dimensions, 2, radius), surface, position)
  }

  function cyl(parent, radius, length, position, surface, axis = 'y', endRadius = radius, segments = 40) {
    const object = mesh(parent, new T.CylinderGeometry(radius, endRadius, length, segments), surface, position)
    if (axis === 'x') object.rotation.z = -Math.PI / 2
    if (axis === 'z') object.rotation.x = Math.PI / 2
    return object
  }

  function bar(parent, start, end, diameter, surface) {
    const a = vector(start)
    const b = vector(end)
    const object = cyl(parent, diameter / 2, a.distanceTo(b), a.clone().lerp(b, 0.5).toArray(), surface, 'y', diameter / 2, 14)
    object.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), b.sub(a).normalize())
    return object
  }

  function cable(parent, points, thickness, surface = rubber) {
    const curve = new T.CatmullRomCurve3(points.map(vector))
    return mesh(parent, new T.TubeGeometry(curve, 32, thickness, 10, false), surface)
  }

  function decal(parent, text, position, width, height, background = '#24282a', ink = '#f9ca49') {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 64
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = background
    ctx.fillRect(0, 0, 256, 64)
    ctx.font = 'bold 34px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = ink
    ctx.fillText(text, 128, 34)
    const texture = new T.CanvasTexture(canvas)
    texture.colorSpace = T.SRGBColorSpace
    return mesh(parent, new T.PlaneGeometry(width, height), new T.MeshBasicMaterial({ map: texture }), position)
  }

  const platform = group(plant, 'platform')
  const decking = material('#303942', 0.24, 0.68)
  const panel = material('#3d4952', 0.28, 0.63)
  box(platform, [10.7, 0.36, 7.8], [0, -0.2, 0], black, 0.14)
  box(platform, [10.5, 0.13, 7.6], [0, -0.03, 0], decking, 0.08)
  for (const x of [-3.42, 0, 3.42]) {
    for (const z of [-2.48, 0, 2.48]) {
      box(platform, [3.37, 0.035, 2.43], [x, 0.037, z], panel, 0.024)
    }
  }
  for (const x of [-5.07, 5.07]) {
    for (const z of [-3.42, 3.42]) {
      box(platform, [0.26, 0.1, 0.61], [x, 0.055, z], gold)
      cyl(platform, 0.053, 0.036, [x, 0.12, z], black, 'y', 0.053, 6)
    }
    for (const z of [-2.1, 0, 2.1]) box(platform, [0.035, 0.15, 0.51], [x * 1.056, -0.18, z], dark)
  }
  for (const z of [-3.64, 3.64]) {
    for (let i = 0; i < 31; i++) {
      const stripe = box(platform, [0.14, 0.013, 0.21], [-4.75 + i * 0.317, 0.065, z], i % 2 ? black : gold, 0.004)
      stripe.rotation.y = -0.38
    }
  }
  const platformLabel = decal(platform, 'CELL / 01', [-3.85, 0.064, 3.17], 1.34, 0.33, '#3d4952', '#a7bbc5')
  platformLabel.rotation.x = -Math.PI / 2

  const robot = group(plant, 'robot', [-2.85, 0.055, -0.34])
  const base = group(robot, 'base')
  box(base, [2.1, 0.23, 1.83], [0, 0.115, 0], black, 0.13)
  box(base, [1.86, 0.13, 1.65], [0, 0.26, 0], dark, 0.07)
  cyl(base, 0.77, 0.24, [0, 0.41, 0], black)
  cyl(base, 0.7, 0.39, [0, 0.69, 0], yellow, 'y', 0.79)
  cyl(base, 0.63, 0.13, [0, 0.93, 0], dark)
  for (const x of [-0.82, 0.82]) {
    for (const z of [-0.69, 0.69]) cyl(base, 0.092, 0.079, [x, 0.32, z], steel, 'y', 0.092, 6)
  }
  decal(base, 'AL / 01', [0, 0.17, 0.917], 0.62, 0.13)

  const shoulder = group(robot, 'shoulder', [0, 1.51, 0])
  box(shoulder, [1.24, 0.67, 0.94], [0, -0.39, 0], yellow, 0.2)
  cyl(shoulder, 0.61, 1.04, [0, 0, 0], yellow, 'z')
  const upper = group(shoulder, 'upper')
  upper.rotation.z = -0.43
  box(upper, [0.89, 2.65, 0.77], [0, 1.31, 0], yellow, 0.19)
  box(upper, [0.23, 2.13, 0.105], [-0.07, 1.27, 0.38], gold, 0.045)
  box(upper, [0.25, 1.81, 0.071], [0.05, 1.26, 0.433], dark, 0.032)
  decal(upper, 'AX-06', [0, 1.43, 0.474], 0.55, 0.137)
  cable(upper, [[-0.47, 0.22, -0.24], [-0.7, 0.64, -0.1], [-0.65, 1.66, -0.1], [-0.55, 2.22, -0.14], [-0.1, 2.65, -0.29]], 0.065)
  cable(upper, [[-0.46, 0.27, -0.03], [-0.59, 0.58, 0.09], [-0.56, 1.6, 0.08], [-0.5, 2.17, 0.03], [-0.14, 2.54, -0.12]], 0.037, dark)
  for (const y of [0.71, 1.89]) box(upper, [0.24, 0.15, 0.42], [-0.47, y, -0.07], dark, 0.035)

  function joint(parent, radius, depth, front, crown) {
    cyl(parent, radius, depth, [0, 0, 0], yellow, 'z')
    for (const side of [-1, 1]) {
      cyl(parent, radius * 0.79, 0.145, [0, 0, side * front], dark, 'z')
      cyl(parent, radius * 0.62, 0.16, [0, 0, side * (front + 0.05)], steel, 'z')
      cyl(parent, radius * 0.36, 0.174, [0, 0, side * (front + 0.09)], crown, 'z')
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4
        cyl(parent, radius * 0.074, 0.035, [Math.cos(angle) * radius * 0.51, Math.sin(angle) * radius * 0.51, side * (front + 0.136)], black, 'z', radius * 0.074, 6)
      }
    }
  }

  joint(shoulder, 0.575, 1.04, 0.51, black)
  const elbow = group(upper, 'elbow', [0, 2.52, 0])
  joint(elbow, 0.48, 0.92, 0.46, gold)
  const forearm = group(elbow, 'forearm')
  forearm.rotation.z = -1.64
  box(forearm, [0.7, 2.67, 0.68], [0, 1.17, 0], yellow, 0.17)
  box(forearm, [0.46, 1.37, 0.11], [0.021, 1.38, 0.352], gold, 0.063)
  for (let i = 0; i < 6; i++) {
    box(forearm, [0.26, 0.038, 0.039], [0.02, 0.95 + i * 0.14, 0.415], dark, 0.012)
  }
  cable(forearm, [[-0.1, 0, -0.43], [-0.49, 0.4, -0.33], [-0.49, 1.34, -0.28], [-0.42, 1.99, -0.24], [-0.1, 2.42, -0.18]], 0.057)
  const wrist = group(forearm, 'wrist', [0, 2.48, 0])
  wrist.rotation.z = -1.07
  joint(wrist, 0.31, 0.63, 0.315, black)
  cyl(wrist, 0.256, 0.39, [0, 0.36, 0], dark)
  const gripper = group(wrist, 'gripper', [0, 0.54, 0])
  cyl(gripper, 0.27, 0.13, [0, 0.06, 0], steel)
  box(gripper, [0.83, 0.24, 0.37], [0, 0.2, 0], dark, 0.057)
  for (const side of [-1, 1]) {
    box(gripper, [0.18, 0.31, 0.32], [side * 0.36, 0.36, 0], steel, 0.045)
    bar(gripper, [side * 0.36, 0.42, 0], [side * 0.5, 0.65, 0], 0.17, steel)
    box(gripper, [0.22, 0.14, 0.31], [side * 0.42, 0.71, 0], black, 0.034)
  }

  const vehicle = group(plant, 'vehicle', [2.05, 0.065, 0.28])
  vehicle.rotation.y = -0.12
  const chassis = group(vehicle, 'chassis')
  box(chassis, [2.27, 0.37, 4.47], [0, 0.65, 0], black, 0.16)
  for (const z of [-1.44, 1.46]) cyl(chassis, 0.11, 2.49, [0, 0.54, z], steel, 'x')
  for (const x of [-0.74, 0.74]) box(chassis, [0.24, 0.25, 4.04], [x, 0.47, 0], dark)

  const body = group(vehicle, 'body')
  function loft(stations, surface) {
    const positions = []
    const triangles = []
    for (const [z, width, bottom, top] of stations) {
      const ring = [[-0.79, 0], [0.79, 0], [1, 0.23], [1, 0.67], [0.84, 0.96], [0.62, 1], [-0.62, 1], [-0.84, 0.96], [-1, 0.67], [-1, 0.23]]
      for (const [x, y] of ring) positions.push(x * width, bottom + y * (top - bottom), z)
    }
    const count = 10
    for (let ring = 0; ring < stations.length - 1; ring++) {
      for (let i = 0; i < count; i++) {
        const a = ring * count + i
        const b = ring * count + (i + 1) % count
        triangles.push(a, b, a + count, b, b + count, a + count)
      }
    }
    const last = (stations.length - 1) * count
    for (let i = 1; i < count - 1; i++) triangles.push(0, i + 1, i, last, last + i, last + i + 1)
    const geometry = new T.BufferGeometry()
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3))
    geometry.setIndex(triangles)
    geometry.computeVertexNormals()
    return mesh(body, geometry, surface)
  }

  loft([
    [-2.51, 0.9, 0.69, 1.19], [-2.36, 1.16, 0.53, 1.32],
    [-1.67, 1.27, 0.69, 1.39], [-1.12, 1.25, 0.74, 1.43],
    [-0.42, 1.17, 0.49, 1.38], [0.56, 1.17, 0.49, 1.37],
    [1.18, 1.24, 0.73, 1.4], [1.7, 1.26, 0.70, 1.33],
    [2.26, 1.19, 0.54, 1.19], [2.51, 0.96, 0.63, 1.08],
  ], blue)
  loft([
    [-1.69, 0.92, 1.32, 1.38], [-1.34, 0.99, 1.35, 1.58],
    [-0.89, 0.91, 1.35, 2], [-0.62, 0.87, 1.35, 2.08],
    [0.11, 0.87, 1.33, 2.055], [0.36, 0.91, 1.33, 1.99],
    [0.92, 1.02, 1.32, 1.48], [1.12, 1.03, 1.3, 1.36],
  ], glass)
  box(body, [1.36, 0.07, 0.82], [0, 2.057, -0.34], blue, 0.035)
  box(body, [1.87, 0.28, 0.18], [0, 0.82, 2.465], black, 0.07)
  box(body, [0.96, 0.15, 0.042], [0, 1.0, 2.518], black, 0.035)
  for (let i = 0; i < 3; i++) box(body, [0.76, 0.014, 0.023], [0, 0.96 + i * 0.035, 2.545], steel, 0.005)
  for (const side of [-1, 1]) {
    box(body, [0.52, 0.092, 0.065], [side * 0.74, 1.08, 2.464], whiteLamp, 0.035).rotation.y = side * 0.19
    box(body, [0.58, 0.092, 0.065], [side * 0.73, 1.17, -2.433], redLamp, 0.035).rotation.y = -side * 0.18
    box(body, [0.14, 0.14, 1.82], [side * 1.135, 0.58, 0], blueTrim, 0.04)
    box(body, [0.06, 0.034, 0.2], [side * 1.17, 1.25, -0.32], steel, 0.014)
    bar(body, [side * 1.005, 1.42, 0.69], [side * 1.234, 1.5, 0.62], 0.074, black)
    box(body, [0.25, 0.125, 0.245], [side * 1.27, 1.51, 0.63], blue, 0.048)
    bar(body, [side * 0.93, 1.43, -0.35], [side * 0.74, 2.02, -0.35], 0.062, blueTrim)
    for (const z of [-1.46, 1.48]) {
      const points = Array.from({ length: 13 }, (_, i) => {
        const angle = i * Math.PI / 12
        return [side * 1.19, 0.54 + Math.sin(angle) * 0.635, z + Math.cos(angle) * 0.635]
      })
      cable(body, points, 0.051, blueTrim)
    }
  }

  const wheels = group(vehicle, 'wheels')
  for (const side of [-1, 1]) {
    for (const z of [-1.46, 1.48]) {
      const x = side * 1.14
      const center = [x, 0.53, z]
      const tire = mesh(wheels, new T.TorusGeometry(0.403, 0.127, 16, 50), rubber, center)
      tire.rotation.y = Math.PI / 2
      cyl(wheels, 0.465, 0.21, center, rubber, 'x')
      cyl(wheels, 0.352, 0.055, [x + side * 0.12, 0.53, z], steel, 'x')
      cyl(wheels, 0.299, 0.059, [x + side * 0.134, 0.53, z], black, 'x')
      for (let i = 0; i < 5; i++) {
        const angle = i * Math.PI * 2 / 5
        const faceX = x + side * 0.168
        for (const offset of [-0.13, 0.13]) {
          bar(wheels, [faceX, 0.53 + Math.sin(angle) * 0.09, z + Math.cos(angle) * 0.09],
            [faceX, 0.53 + Math.sin(angle + offset) * 0.312, z + Math.cos(angle + offset) * 0.312], 0.036, light)
        }
      }
      cyl(wheels, 0.112, 0.07, [x + side * 0.169, 0.53, z], steel, 'x')
    }
  }

  return { plant, objects }
}
