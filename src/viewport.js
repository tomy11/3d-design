import * as T from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { makeFactory } from './factory'

export const keyframes = [
  { frame: 0, name: 'Ready', lift: 0, reach: 0, wrist: 0 },
  { frame: 30, name: 'Approach', lift: -0.3, reach: 0.12, wrist: 0.18 },
  { frame: 60, name: 'Assemble', lift: -0.4, reach: -0.08, wrist: 0.43 },
  { frame: 90, name: 'Retract', lift: 0.16, reach: 0.27, wrist: -0.35 },
  { frame: 120, name: 'Home', lift: 0, reach: 0, wrist: 0 },
]

const axes = ['x', 'y', 'z']
const poses = { perspective: [9, 6.2, 13], top: [0, 1, 0.001], right: [1, 0, 0], front: [0, 0, 1] }

function samplePose(frame, channel) {
  const next = keyframes.findIndex((item) => item.frame > frame)
  if (next === -1) return keyframes.at(-1)[channel]
  const a = keyframes[next - 1]
  const b = keyframes[next]
  const progress = (frame - a.frame) / (b.frame - a.frame)
  return T.MathUtils.lerp(a[channel], b[channel], progress * progress * (3 - 2 * progress))
}

export function createViewport(element, { onSelect, onChange, onOrbit }) {
  const scene = new T.Scene()
  scene.background = new T.Color('#21272e')
  scene.fog = new T.Fog('#21272e', 19, 48)
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = T.PCFShadowMap
  renderer.toneMapping = T.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.22
  renderer.domElement.setAttribute('aria-label', 'Interactive 3D view of the automotive assembly cell')
  element.appendChild(renderer.domElement)

  const camera = new T.PerspectiveCamera(39, 1, 0.1, 120)
  const orbit = new OrbitControls(camera, renderer.domElement)
  orbit.enableDamping = true
  orbit.dampingFactor = 0.14
  orbit.minDistance = 2.5
  orbit.maxDistance = 55
  orbit.maxPolarAngle = Math.PI * 0.515
  orbit.mouseButtons.MIDDLE = T.MOUSE.PAN
  let dirty = true
  let interacting = false
  orbit.addEventListener('start', () => { interacting = true })
  orbit.addEventListener('end', () => { interacting = false })
  orbit.addEventListener('change', () => {
    dirty = true
    if (interacting) onOrbit()
  })

  const lights = [
    new T.HemisphereLight('#e2f2ff', '#5f503f', 2.1),
    new T.DirectionalLight('#fff0d1', 3.0),
    new T.DirectionalLight('#a0caff', 1.7),
  ]
  lights[1].position.set(-4, 10, 7)
  lights[1].castShadow = true
  lights[1].shadow.mapSize.set(2048, 2048)
  Object.assign(lights[1].shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 0.2, far: 28 })
  lights[1].shadow.normalBias = 0.025
  lights[1].shadow.bias = -0.00013
  lights[2].position.set(4, 6, -7)
  scene.add(...lights)

  const floor = new T.Mesh(new T.PlaneGeometry(180, 180), new T.MeshStandardMaterial({ color: '#343c47', roughness: 1 }))
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -0.386
  floor.receiveShadow = true
  scene.add(floor)

  const grid = new T.GridHelper(100, 100, '#9ea7ae', '#8c98a3')
  grid.position.y = -0.378
  grid.material.transparent = true
  grid.material.opacity = 0.26
  grid.material.toneMapped = false
  scene.add(grid)

  const { plant, objects } = makeFactory()
  scene.add(plant)
  const wireframes = new Map()
  plant.traverse((node) => {
    if (node.isMesh) wireframes.set(node.material, node.material.wireframe)
  })
  const defaults = Object.fromEntries(Object.entries(objects).map(([id, object]) => [
    id, { position: object.position.clone(), rotation: object.rotation.clone(), scale: object.scale.clone() },
  ]))

  function motionPivot(id) {
    const object = objects[id]
    const pivot = new T.Group()
    pivot.name = id + '_motion'
    object.add(pivot)
    for (const child of [...object.children]) {
      if (child !== pivot) pivot.add(child)
    }
    return pivot
  }
  const lift = motionPivot('upper')
  const reach = motionPivot('forearm')
  const wrist = motionPivot('wrist')

  const gizmo = new TransformControls(camera, renderer.domElement)
  gizmo.setSize(0.75)
  gizmo.addEventListener('dragging-changed', (event) => { orbit.enabled = !event.value })
  gizmo.addEventListener('change', () => { dirty = true })
  gizmo.addEventListener('objectChange', onChange)
  scene.add(gizmo.getHelper())

  let selected = 'upper'
  let mode = 'select'
  const outline = new T.Group()
  scene.add(outline)
  const outlineMaterial = new T.LineBasicMaterial({ color: '#ffc254', transparent: true, opacity: 0.83 })
  let outlinedMeshes = []

  function effectivelyVisible(node) {
    for (let current = node; current; current = current.parent) {
      if (!current.visible) return false
    }
    return true
  }

  function updateOutline() {
    for (const { source, line } of outlinedMeshes) {
      line.visible = effectivelyVisible(source)
      line.matrix.copy(source.matrixWorld)
      line.matrixWorldNeedsUpdate = true
    }
  }

  function updateSelection(id, tool = mode) {
    dirty = true
    selected = id
    mode = tool
    gizmo.detach()
    for (const { line } of outlinedMeshes) line.geometry.dispose()
    outline.clear()
    outlinedMeshes = []
    const object = objects[id]
    if (!object || !effectivelyVisible(object)) return
    if (tool !== 'select') {
      gizmo.setMode(tool)
      gizmo.attach(object)
    }
    object.traverse((node) => {
      if (!node.isMesh || node.material.map) return
      let owner = node.parent
      while (owner && !owner.userData.part) owner = owner.parent
      if (owner !== object) return
      const line = new T.LineSegments(new T.EdgesGeometry(node.geometry, 41), outlineMaterial)
      line.matrixAutoUpdate = false
      outlinedMeshes.push({ source: node, line })
      outline.add(line)
    })
  }

  function view(name) {
    orbit.target.set(0, 1.32, 0)
    const direction = new T.Vector3(...poses[name]).normalize()
    const distance = 16.9 * Math.max(1, 1.23 / camera.aspect)
    camera.position.copy(orbit.target).addScaledVector(direction, distance)
    orbit.update()
  }

  function focus() {
    const object = objects[selected]
    if (!object || !effectivelyVisible(object)) return
    scene.updateMatrixWorld()
    const bounds = new T.Box3().setFromObject(object)
    if (bounds.isEmpty()) return
    const direction = camera.position.clone().sub(orbit.target).normalize()
    const sphere = bounds.getBoundingSphere(new T.Sphere())
    orbit.target.copy(sphere.center)
    camera.position.copy(sphere.center).addScaledVector(direction, Math.max(3.5, sphere.radius * 3.3 / Math.min(camera.aspect, 1)))
    orbit.update()
  }

  function resize() {
    const { clientWidth, clientHeight } = element
    if (!clientWidth || !clientHeight) return
    camera.aspect = clientWidth / clientHeight
    camera.updateProjectionMatrix()
    renderer.setSize(clientWidth, clientHeight)
    dirty = true
  }

  const observer = new ResizeObserver(resize)
  observer.observe(element)
  resize()
  view('perspective')
  updateSelection(selected)

  const raycaster = new T.Raycaster()
  let pointerDown
  function begin(event) {
    if (event.button !== 0) return
    pointerDown = { x: event.clientX, y: event.clientY, gizmo: gizmo.dragging }
  }
  function pick(event) {
    const start = pointerDown
    pointerDown = null
    if (!start || start.gizmo || event.button !== 0 || Math.hypot(start.x - event.clientX, start.y - event.clientY) > 5) return
    const rect = renderer.domElement.getBoundingClientRect()
    const pointer = new T.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2)
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObject(plant).find(({ object }) => effectivelyVisible(object))
    let object = hit?.object
    while (object && !object.userData.part) object = object.parent
    onSelect(object?.userData.part ?? null)
  }
  renderer.domElement.addEventListener('pointerdown', begin)
  renderer.domElement.addEventListener('pointerup', pick)

  renderer.setAnimationLoop(() => {
    orbit.update()
    if (!dirty) return
    dirty = false
    scene.updateMatrixWorld()
    updateOutline()
    renderer.render(scene, camera)
  })

  return {
    select: updateSelection,
    view,
    focus,
    setFrame(frame) {
      dirty = true
      lift.rotation.z = samplePose(frame, 'lift')
      reach.rotation.z = samplePose(frame, 'reach')
      wrist.rotation.z = samplePose(frame, 'wrist')
    },
    setVisibility(hidden) {
      for (const [id, object] of Object.entries(objects)) object.visible = !hidden.includes(id)
      updateSelection(selected)
    },
    setWireframe(enabled) {
      dirty = true
      for (const [material, initial] of wireframes) material.wireframe = enabled || initial
    },
    setGrid(visible) {
      dirty = true
      grid.visible = visible
    },
    read(id) {
      const object = objects[id]
      if (!object) return null
      return Object.fromEntries(['position', 'rotation', 'scale'].map((type) => [
        type, axes.map((axis) => type === 'rotation' ? T.MathUtils.radToDeg(object[type][axis]) : object[type][axis]),
      ]))
    },
    write(id, type, axis, value) {
      dirty = true
      objects[id][type][axis] = type === 'rotation' ? T.MathUtils.degToRad(value) : value
      onChange()
    },
    reset(id) {
      dirty = true
      const entries = id ? [[id, objects[id]]] : Object.entries(objects)
      for (const [key, object] of entries) {
        for (const type of ['position', 'rotation', 'scale']) object[type].copy(defaults[key][type])
      }
      onChange()
    },
    async export() {
      const snapshot = plant.clone()
      const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js')
      const end = keyframes.at(-1).frame
      const times = Array.from({ length: end + 1 }, (_, frame) => frame / 30)
      const orientation = new T.Quaternion()
      const axis = new T.Vector3(0, 0, 1)
      const tracks = [[lift, 'lift'], [reach, 'reach'], [wrist, 'wrist']].map(([pivot, channel]) => {
        snapshot.getObjectByName(pivot.name).rotation.z = 0
        const values = times.flatMap((_, frame) => orientation.setFromAxisAngle(axis, samplePose(frame, channel)).toArray())
        return new T.QuaternionKeyframeTrack(pivot.name + '.quaternion', times, values)
      })
      const clip = new T.AnimationClip('Assembly cycle', end / 30, tracks)
      const buffer = await new GLTFExporter().parseAsync(snapshot, { binary: true, onlyVisible: false, animations: [clip] })
      const url = URL.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'assembly-cell.glb'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    },
    dispose() {
      renderer.setAnimationLoop(null)
      observer.disconnect()
      orbit.dispose()
      gizmo.dispose()
      const materials = new Set()
      scene.traverse((object) => {
        object.geometry?.dispose()
        if (object.material) materials.add(object.material)
      })
      for (const material of materials) {
        material.map?.dispose()
        material.dispose()
      }
      outlineMaterial.dispose()
      for (const light of lights) light.shadow?.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
