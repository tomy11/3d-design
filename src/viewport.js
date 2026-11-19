import * as T from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { anglesAt, loadRobot, makeMotionClip } from './robot'
import modelNotice from '../public/models/ur10e-license.txt?raw'

const axes = ['x', 'y', 'z']
const poses = { perspective: [2.05, 2.1, 6.1], top: [0, 1, 0.001], right: [1, 0, 0], front: [0, 0, 1] }

export async function createViewport(element, { onSelect, onChange, onOrbit, signal }) {
  const robot = await loadRobot()
  signal.throwIfAborted()
  const { plant, objects, pivots, visuals } = robot
  const linkVisuals = Object.fromEntries(visuals.map(({ id, node }) => [id, node]))
  let explosion = 0
  robot.setAngles(anglesAt(0))
  const scene = new T.Scene()
  scene.background = new T.Color('#21272e')
  scene.fog = new T.Fog('#21272e', 3.5, 10)
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = T.PCFShadowMap
  renderer.toneMapping = T.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.11
  renderer.domElement.setAttribute('aria-label', 'Interactive 3D view of the Universal Robots UR10e')
  element.appendChild(renderer.domElement)

  const pmrem = new T.PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  const environment = pmrem.fromScene(room, 0.04)
  scene.environment = environment.texture
  scene.environmentIntensity = 0.53
  room.dispose()
  pmrem.dispose()

  const camera = new T.PerspectiveCamera(38, 1, 0.014, 42)
  const orbit = new OrbitControls(camera, renderer.domElement)
  orbit.enableDamping = true
  orbit.dampingFactor = 0.14
  orbit.minDistance = 0.055
  orbit.maxDistance = 13
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
    new T.HemisphereLight('#dceeff', '#707b91', 1.4),
    new T.DirectionalLight('#fff3e5', 2.2),
    new T.DirectionalLight('#b2d5ff', 1.8),
  ]
  lights[1].position.set(-2.3, 4, 3.1)
  lights[1].castShadow = true
  lights[1].shadow.mapSize.set(2048, 2048)
  Object.assign(lights[1].shadow.camera, { left: -2.4, right: 2.4, top: 2.4, bottom: -2.4, near: 0.1, far: 11 })
  lights[1].shadow.normalBias = 0.004
  lights[1].shadow.bias = -0.00013
  lights[2].position.set(2, 3, -2.5)
  scene.add(...lights)

  const floor = new T.Mesh(new T.PlaneGeometry(60, 60), new T.MeshStandardMaterial({ color: '#2d3540', roughness: 1 }))
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -0.006
  floor.receiveShadow = true
  scene.add(floor)

  const grid = new T.GridHelper(20, 200, '#9ea7ae', '#8c98a3')
  grid.position.y = -0.004
  grid.material.transparent = true
  grid.material.opacity = 0.22
  grid.material.toneMapped = false
  scene.add(grid)

  scene.add(plant)
  const wireframes = new Map()
  plant.traverse((node) => {
    if (!node.isMesh) return
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    for (const material of materials) wireframes.set(material, material.wireframe)
  })
  const defaults = Object.fromEntries(Object.entries(objects).map(([id, object]) => [
    id, { position: object.position.clone(), rotation: object.rotation.clone(), scale: object.scale.clone() },
  ]))

  const gizmo = new TransformControls(camera, renderer.domElement)
  gizmo.setSize(0.75)
  gizmo.addEventListener('dragging-changed', (event) => { orbit.enabled = !event.value })
  gizmo.addEventListener('change', () => { dirty = true })
  gizmo.addEventListener('objectChange', () => {
    if (explosion) robot.separate(explosion)
    onChange()
  })
  scene.add(gizmo.getHelper())

  let selected = 'upperarm'
  let mode = 'select'
  const outline = new T.Group()
  scene.add(outline)
  const outlineMaterial = new T.LineBasicMaterial({ color: '#ffc254', transparent: true, opacity: 0.68 })
  const edges = new Map()
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
    outline.clear()
    outlinedMeshes = []
    const object = objects[id]
    if (!object || !effectivelyVisible(linkVisuals[id] ?? object)) return
    if (tool !== 'select') {
      gizmo.setMode(tool)
      gizmo.attach(object)
    }
    const visual = linkVisuals[id] ?? object
    if (id === 'robot') return
    visual.traverse((node) => {
      if (!node.isMesh) return
      if (!edges.has(node.geometry)) edges.set(node.geometry, new T.EdgesGeometry(node.geometry, 55))
      const line = new T.LineSegments(edges.get(node.geometry), outlineMaterial)
      line.matrixAutoUpdate = false
      outlinedMeshes.push({ source: node, line })
      outline.add(line)
    })
  }

  function view(name) {
    orbit.target.set(0.44 + 0.27 * explosion, 0.48 + 0.19 * explosion, -0.04)
    const direction = new T.Vector3(...poses[name]).normalize()
    const distance = (1.91 + 0.60 * explosion) * Math.max(1, 1.14 / camera.aspect)
    camera.position.copy(orbit.target).addScaledVector(direction, distance)
    orbit.update()
  }

  function focus() {
    const object = linkVisuals[selected] ?? objects[selected]
    if (!object || !effectivelyVisible(object)) return
    scene.updateMatrixWorld()
    const bounds = new T.Box3()
    object.traverse((node) => {
      if (!node.isMesh || !effectivelyVisible(node)) return
      bounds.union(node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld))
    })
    if (bounds.isEmpty()) return
    const direction = camera.position.clone().sub(orbit.target).normalize()
    const sphere = bounds.getBoundingSphere(new T.Sphere())
    orbit.target.copy(sphere.center)
    camera.position.copy(sphere.center).addScaledVector(direction, Math.max(0.13, sphere.radius * 3.4 / Math.min(camera.aspect, 1)))
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
    setPose(angles) {
      dirty = true
      robot.setAngles(angles)
      if (explosion) robot.separate(explosion)
    },
    setExplosion(amount, reframe = false) {
      dirty = true
      explosion = amount
      robot.separate(explosion)
      if (reframe) view('perspective')
    },
    setVisibility(visible) {
      for (const [id, object] of Object.entries(objects)) {
        (linkVisuals[id] ?? object).visible = visible.has(id)
      }
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
      if (explosion) robot.separate(explosion)
      onChange()
    },
    reset(id) {
      dirty = true
      const entries = id ? [[id, objects[id]]] : Object.entries(objects)
      for (const [key, object] of entries) {
        for (const type of ['position', 'rotation', 'scale']) object[type].copy(defaults[key][type])
      }
      if (explosion) robot.separate(explosion)
      onChange()
    },
    async export() {
      const snapshot = plant.clone()
      snapshot.userData.notice = modelNotice
      for (const { node, components } of visuals) {
        snapshot.getObjectByName(node.name).position.set(0, 0, 0)
        for (const { node: part } of components) snapshot.getObjectByName(part.name).position.set(0, 0, 0)
      }
      const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js')
      const clip = makeMotionClip(pivots)
      const buffer = await new GLTFExporter().parseAsync(snapshot, { binary: true, onlyVisible: false, animations: [clip] })
      const url = URL.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'universal-robots-ur10e.glb'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    },
    dispose() {
      renderer.setAnimationLoop(null)
      observer.disconnect()
      orbit.dispose()
      gizmo.dispose()
      const materials = new Set()
      const geometries = new Set(edges.values())
      scene.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry)
        if (Array.isArray(object.material)) for (const material of object.material) materials.add(material)
        else if (object.material) materials.add(object.material)
      })
      for (const geometry of geometries) geometry.dispose()
      for (const material of materials) {
        material.map?.dispose()
        material.dispose()
      }
      outlineMaterial.dispose()
      environment.dispose()
      for (const light of lights) light.shadow?.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
