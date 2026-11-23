import { Suspense, lazy, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  Box, Boxes, CircleHelp, Download, Focus, Maximize2, Minimize2, PanelRight, PanelBottom, FolderOpen, Magnet, Redo2, Ruler, Save, Scissors, Undo2, Grid2X2, Layers3, Expand, Maximize, MousePointer2, Move, Pause, Play, RotateCcw, RotateCw, ScanLine, SlidersHorizontal, Wrench, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { hierarchy, joints, keyframes, licenseUrl, meshCount, sourceUrl } from './robot'
import { fps, persistTaughtProgram, pickProgram, readTaughtProgram, sampleProgram, teachEnd } from './program'
import { PickPanel, ServiceFooter, ServicePanels, TeachPanels, ToolFrame } from './ModePanels'
import { gripperLicense, gripperSource } from './pick-cell'
import { CadPanel, ViewPanel } from './CadPanel'
import { IconButton, Inspector, SceneTree, Timeline, parts, visibleParts } from './InspectPanels'
import { useTraceWorkbench } from './useTraceWorkbench'
import { createAdapterCommands } from './adapter-commands'
import { useDesktopMcp } from './desktop-mcp'
import { runCad } from './adapter-client'
import { decodeProject, desktop, openNativeProject, readBrowserProject, saveProject, saveStep } from './project-file'
import { createViewport } from './viewport'

// The trace workbench (image tracing, straightening, mesh tools) loads the first time it is opened.
const TracePanel = lazy(() => import('./TracePanel').then((module) => ({ default: module.TracePanel })))

const tools = [
  { id: 'select', icon: MousePointer2, label: 'Select', key: 'V' },
  { id: 'translate', icon: Move, label: 'Move', key: 'G' },
  { id: 'rotate', icon: RotateCw, label: 'Rotate', key: 'R' },
  { id: 'scale', icon: Maximize, label: 'Scale', key: 'S' },
]
const sidebarMin = 280
const sidebarMax = 480
const clampSidebar = (width) => Math.max(sidebarMin, Math.min(sidebarMax, width))

const toolKeys = Object.fromEntries(tools.map((tool) => [tool.key.toLowerCase(), tool.id]))
const viewLabels = { perspective: 'Perspective', orbit: 'Perspective', top: 'Top', front: 'Front', right: 'Right' }
const modes = [
  { id: 'inspect', label: 'Inspect', icon: Layers3 },
  { id: 'teach', label: 'Teach Mode', compact: 'Teach', icon: ScanLine },
  { id: 'pick', label: 'Pick & Place', icon: Box },
  { id: 'service', label: 'Service Mode', compact: 'Service', icon: Wrench },
  { id: 'cad', label: 'CAD', icon: SlidersHorizontal },
]

export default function App() {
  const mount = useRef(null)
  const splitterDrag = useRef(null)
  const [sidebarWidth, setSidebarWidth] = useState(330)
  const [dock, setDock] = useState(true)
  const [timeline, setTimeline] = useState(true)
  const [focused, setFocused] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const viewport = useRef(null)
  const dialog = useRef(null)
  const fileInput = useRef(null)
  const history = useRef({ undo: [], redo: [] })
  const editRevision = useRef(0)
  const [, setHistoryVersion] = useState(0)
  const [projectBusy, setProjectBusy] = useState(false)
  const [sceneRestore, setSceneRestore] = useState(null)
  const [adapterCommands] = useState(() => createAdapterCommands({
    runCad,
    onEdit: (before, after) => recordChange({ type: 'adapter', label: 'adapter dimensions', before, after }),
  }))
  const { revision: adapterRevision, dimensions, mesh: adapterMesh, building: adapterBuilding } =
    useSyncExternalStore(adapterCommands.subscribe, adapterCommands.getSnapshot)
  const [cadMeshBuilding, setCadMeshBuilding] = useState(false)
  const [cadError, setCadError] = useState('')
  const [cadSource, setCadSource] = useState('adapter')
  const cadBuilding = cadMeshBuilding || (cadSource === 'adapter' && adapterBuilding)
  const [stepExporting, setStepExporting] = useState(false)
  const [snap, setSnap] = useState(false)
  const [measure, setMeasure] = useState(false)
  const [measurement, setMeasurement] = useState({ count: 0, distance: 0 })
  const [section, setSection] = useState({ enabled: false, axis: 'x', offset: 0 })
  const [selected, setSelected] = useState('upperarm')
  const [expanded, setExpanded] = useState(['robot'])
  const [hidden, setHidden] = useState([])
  const [isolated, setIsolated] = useState(null)
  const [workspace, setWorkspace] = useState('inspect')
  const [taught, setTaught] = useState(readTaughtProgram)
  const [toolValues, setToolValues] = useState(null)
  const [showAxes, setShowAxes] = useState(true)
  const [servicePose, setServicePose] = useState(keyframes[0].angles)
  const [serviceJoint, setServiceJoint] = useState(1)
  const [servicePart, setServicePart] = useState(null)
  const [serviceHidden, setServiceHidden] = useState([])
  const [separation, setSeparation] = useState(0.62)
  const [explosion, setExplosion] = useState(0)
  const [overrides, setOverrides] = useState({})
  const [ready, setReady] = useState(false)
  const visible = useMemo(() => visibleParts(hidden, isolated), [hidden, isolated])
  const [tool, setTool] = useState('select')
  const [view, setView] = useState('perspective')
  const [wireframe, setWireframe] = useState(false)
  const [grid, setGrid] = useState(true)
  const [, setTransformVersion] = useState(0)
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [notice, setNotice] = useState('')
  const traced = useTraceWorkbench({ viewport, recordChange, setNotice })
  const { traceSpec, mesh } = traced
  // Stays mounted once opened so the imported image and point edits survive switching modes.
  const [traceOpened, setTraceOpened] = useState(false)
  if (workspace === 'cad' && cadSource === 'trace' && !traceOpened) setTraceOpened(true)
  const rotateMcpProjectId = useDesktopMcp(ready, adapterCommands, setNotice, {
    get_scene: () => ({ revision: editRevision.current, ...viewport.current.sceneReadout(cadSource) }),
    get_robot_pose: () => ({ revision: editRevision.current, ...viewport.current.robotPoseReadout() }),
  })
  const [error, setError] = useState(false)
  const frameRef = useRef(0)
  const cameraMoved = useRef(false)
  const program = workspace === 'teach' ? taught : workspace === 'pick' ? pickProgram : keyframes
  const lastFrame = workspace === 'teach' ? teachEnd : program.at(-1).frame
  const canPlay = ready && workspace !== 'service' && workspace !== 'cad' && (workspace !== 'teach' || taught.length > 1)
  const pose = useMemo(() => {
    if (workspace === 'service') return servicePose
    return sampleProgram(program, frame).map((angle, index) => overrides[index] ?? angle)
  }, [workspace, servicePose, program, frame, overrides])

  function recordChange(change) {
    if (JSON.stringify(change.before) === JSON.stringify(change.after)) return
    const stack = history.current.undo
    stack.push(change)
    if (stack.length > 100) stack.shift()
    history.current.redo.length = 0
    editRevision.current += 1
    setHistoryVersion((version) => version + 1)
  }

  function moveHistory(direction) {
    if (adapterCommands.getSnapshot().building) return
    const from = history.current[direction]
    const change = from.pop()
    if (!change) return
    const undo = direction === 'undo'
    const value = undo ? change.before : change.after
    if (change.type === 'adapter') adapterCommands.restore(value)
    if (change.type === 'trace') traced.setTrace(value)
    if (change.type === 'transform') viewport.current?.restoreTransform(change.id, value)
    if (change.type === 'visibility') setHidden(value)
    if (change.type === 'taught') {
      setPlaying(false)
      setTaught(value)
      persistTaughtProgram(value)
    }
    history.current[undo ? 'redo' : 'undo'].push(change)
    editRevision.current += 1
    setHistoryVersion((version) => version + 1)
    setNotice((undo ? 'Undid ' : 'Redid ') + change.label + '.')
  }

  async function applyDimensions(next) {
    try {
      await adapterCommands.set_adapter_dimensions({ dimensions: next, expected_revision: adapterRevision })
    } catch (failure) {
      setNotice(failure?.message ?? String(failure))
    }
  }

  async function exportAdapter() {
    setStepExporting(true)
    try {
      const tracing = cadSource === 'trace'
      const document = tracing ? await runCad('step', traceSpec, 'trace') : await runCad('step', adapterCommands.get_body().dimensions)
      if (await saveStep(document, tracing ? 'traced-part.step' : 'flange-adapter.step')) {
        setNotice(tracing ? 'Traced part exported as STEP.' : 'Flange adapter exported as STEP.')
      }
    } catch (failure) {
      setNotice(failure?.message ?? String(failure))
    } finally {
      setStepExporting(false)
    }
  }

  async function applyProject(source) {
    const snapshot = decodeProject(source, { modes: modes.map(({ id }) => id), parts: Object.keys(parts), joints })
    await traced.restore(snapshot.traced)
    setCadSource(snapshot.cadSource)
    setPlaying(false)
    setWorkspace(snapshot.workspace)
    setView('orbit')
    setTool('select')
    setMeasure(false)
    setFrame(snapshot.frame)
    setTaught(snapshot.taught)
    setOverrides(Object.fromEntries(snapshot.pose.map((angle, index) => [index, angle])))
    setServicePose(snapshot.pose)
    adapterCommands.restore(snapshot.adapter)
    rotateMcpProjectId()
    setExpanded(snapshot.expanded)
    setSelected(snapshot.selected)
    setHidden(snapshot.hidden)
    setIsolated(snapshot.isolated)
    setGrid(snapshot.grid)
    setWireframe(snapshot.wireframe)
    setSnap(snapshot.snap)
    setSection(snapshot.section)
    setShowAxes(snapshot.showAxes)
    setExplosion(snapshot.explosion)
    setServiceJoint(snapshot.service.joint)
    setServicePart(snapshot.service.part)
    setServiceHidden(snapshot.service.hidden)
    setSeparation(snapshot.service.separation)
    cameraMoved.current = true
    history.current = { undo: [], redo: [] }
    editRevision.current = 0
    setSceneRestore({ transforms: snapshot.transforms, camera: snapshot.camera })
    setNotice('Project opened.')
  }

  async function openProject(file) {
    if (projectBusy || !ready) return
    if (!desktop && !file) {
      fileInput.current.click()
      return
    }
    setProjectBusy(true)
    try {
      const source = file ? await readBrowserProject(file) : await openNativeProject()
      if (source !== null) await applyProject(source)
    } catch (failure) {
      setNotice('Could not open project. ' + (failure?.message ?? String(failure)))
    } finally {
      setProjectBusy(false)
    }
  }

  async function writeProject() {
    if (projectBusy || !ready || adapterCommands.getSnapshot().building) return
    setProjectBusy(true)
    try {
      const outcome = await saveProject({
        workspace, frame, pose, taught, adapter: adapterCommands.get_body().dimensions, selected, hidden, isolated, expanded,
        grid, wireframe, snap, section, showAxes, explosion,
        service: { joint: serviceJoint, part: servicePart, hidden: serviceHidden, separation },
        cadSource, trace: traced.serialize(),
        ...viewport.current.captureScene(),
      })
      if (outcome) setNotice('Project saved.')
    } catch (failure) {
      setNotice('Could not save project. ' + (failure?.message ?? String(failure)))
    } finally {
      setProjectBusy(false)
    }
  }

  function showInspector() {
    setFocused(false)
    setDock(true)
  }

  function resizeDock(event) {
    const start = splitterDrag.current
    if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    setSidebarWidth(clampSidebar(start.width + start.x - event.clientX))
  }

  useEffect(() => {
    if (desktop) {
      let active = true
      async function syncNative() {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window')
          const value = await getCurrentWindow().isFullscreen()
          if (active) setFullscreen(value)
        } catch {
          // The viewport focus control remains available in older desktop builds.
        }
      }
      syncNative()
      window.addEventListener('resize', syncNative)
      return () => { active = false; window.removeEventListener('resize', syncNative) }
    }
    function syncBrowser() {
      setFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', syncBrowser)
    return () => document.removeEventListener('fullscreenchange', syncBrowser)
  }, [])

  async function toggleFullscreen() {
    try {
      if (desktop) {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        const window = getCurrentWindow()
        const next = !(await window.isFullscreen())
        await window.setFullscreen(next)
        setFullscreen(next)
      } else if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else if (document.fullscreenEnabled && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen()
      } else {
        setFocused((current) => !current)
      }
    } catch {
      setFocused((current) => !current)
    }
  }

  function switchWorkspace(next) {
    if (next === workspace) return
    if (next !== 'inspect') showInspector()
    if (next === 'service') setServicePose(pose)
    setMeasure(false)
    setPlaying(false)
    setFrame(0)
    setOverrides({})
    setTool('select')
    setView('perspective')
    setWorkspace(next)
    cameraMoved.current = false
  }

  function savePose() {
    setPlaying(false)
    const entry = { frame, angles: [...pose] }
    const next = [...taught.filter((key) => key.frame !== frame), entry].sort((a, b) => a.frame - b.frame)
    recordChange({ type: 'taught', label: 'taught pose', before: taught, after: next })
    setTaught(next)
    setOverrides({})
    setNotice(persistTaughtProgram(next) ? `Pose saved at frame ${frame}.` : 'Pose saved for this session. Browser storage is unavailable.')
  }

  function deletePose(at) {
    if (taught.length <= 2) setPlaying(false)
    const next = taught.filter((key) => key.frame !== at)
    recordChange({ type: 'taught', label: 'pose deletion', before: taught, after: next })
    setTaught(next)
    if (!persistTaughtProgram(next)) setNotice('Browser storage is unavailable.')
  }

  function seek(next) {
    setOverrides({})
    setFrame(next)
  }

  function setJoint(index, angle) {
    setPlaying(false)
    if (pose[index] !== angle) editRevision.current += 1
    setOverrides((previous) => ({ ...previous, [index]: angle }))
  }

  function togglePlayback() {
    if (!canPlay) return
    if (!playing) setOverrides({})
    setPlaying(!playing)
  }

  function changeExplosion(amount, reframe = false) {
    setExplosion(amount)
    viewport.current?.setExplosion(amount, reframe)
    if (reframe) setView('perspective')
  }

  function choose(id) {
    setSelected(id)
    if (id) setExpanded((open) => [...new Set([...open, ...parts[id].parents])])
  }

  useEffect(() => {
    const controller = new AbortController()
    createViewport(mount.current, {
      signal: controller.signal,
      onSelect: choose,
      onSelectDrive: setServicePart,
      onMeasure: setMeasurement,
      onTransform: (change) => recordChange({ ...change, type: 'transform', label: 'object transform' }),
      onChange: () => setTransformVersion((version) => version + 1),
      onOrbit: () => { cameraMoved.current = true; setView('orbit') },
    }).then((api) => {
      if (controller.signal.aborted) {
        api.dispose()
        return
      }
      viewport.current = api
      setReady(true)
    }).catch((failure) => {
      if (controller.signal.aborted) return
      console.error(failure)
      setError(true)
    })
    return () => {
      controller.abort()
      viewport.current?.dispose()
      viewport.current = null
    }
  }, [])

  useEffect(() => {
    const api = viewport.current
    if (!api) return
    api.setExplosion(0)
    api.setWorkspace(workspace)
  }, [ready, workspace])

  useEffect(() => { viewport.current?.select(selected, tool) }, [ready, selected, tool])
  useEffect(() => {
    viewport.current?.setVisibility(workspace === 'pick' || workspace === 'service' || workspace === 'cad' ? visibleParts([], null) : visible)
  }, [ready, visible, workspace])
  useEffect(() => { viewport.current?.setWireframe(wireframe && workspace === 'inspect') }, [ready, wireframe, workspace])
  useEffect(() => { viewport.current?.setGrid(grid) }, [ready, grid])
  useEffect(() => { viewport.current?.setToolAxes(showAxes) }, [ready, showAxes])
  useEffect(() => {
    if (workspace === 'inspect') viewport.current?.setExplosion(explosion, false)
  }, [ready, workspace, explosion])
  useEffect(() => {
    const api = viewport.current
    if (api) {
      api.setPose(pose, frame)
      if (workspace === 'teach' || workspace === 'pick') setToolValues(api.toolReadout())
    }
    frameRef.current = frame
  }, [ready, frame, pose, workspace])
  useEffect(() => {
    viewport.current?.configureService(serviceJoint, separation, serviceHidden, servicePart)
  }, [ready, workspace, serviceJoint, separation, serviceHidden, servicePart])

  useEffect(() => { viewport.current?.setSnap(snap) }, [ready, snap])
  useEffect(() => { viewport.current?.setMeasure(measure) }, [ready, measure])
  useEffect(() => { viewport.current?.setSection(section) }, [ready, section])
  useEffect(() => { viewport.current?.setReference(undefined, Boolean(mesh?.visible) && cadSource === 'trace') }, [ready, mesh, cadSource])
  useEffect(() => {
    if (ready && sceneRestore) viewport.current?.restoreScene(sceneRestore)
  }, [ready, sceneRestore])
  useEffect(() => {
    if (!ready || workspace !== 'cad') return
    let current = true
    setCadError('')
    const tracing = cadSource === 'trace'
    if (tracing && !traceSpec) {
      viewport.current?.setAdapter({ positions: new Float32Array(), normals: new Float32Array(), indices: new Uint32Array() }, cadSource)
      setCadMeshBuilding(false)
      return
    }
    viewport.current?.refitAdapter()
    if (!tracing && adapterMesh) {
      viewport.current?.setAdapter(adapterMesh, cadSource)
      setCadMeshBuilding(false)
      return
    }
    setCadMeshBuilding(true)
    const build = tracing ? runCad('mesh', traceSpec, 'trace') : runCad('mesh', dimensions)
    build.then((mesh) => {
      if (current) viewport.current?.setAdapter(mesh, cadSource)
    }).catch((failure) => {
      if (current) setCadError('Open CASCADE could not rebuild the solid. ' + (failure?.message ?? String(failure)))
    }).finally(() => {
      if (current) setCadMeshBuilding(false)
    })
    return () => { current = false }
  }, [ready, workspace, dimensions, adapterMesh, cadSource, traceSpec])

  useEffect(() => {
    if (!playing) return
    const start = performance.now() - (frameRef.current % (lastFrame + 1)) / fps * 1000
    let request
    function tick(now) {
      setFrame(Math.max(0, Math.floor((now - start) / 1000 * fps)) % (lastFrame + 1))
      request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [playing, lastFrame])

  useEffect(() => {
    function shortcut(event) {
      if (dialog.current?.open || event.altKey || event.target.closest('input, select, textarea, [role="slider"]')) return
      const key = event.key.toLowerCase()
      if (event.metaKey || event.ctrlKey) {
        if (key === 'z' || key === 'y') {
          event.preventDefault()
          moveHistory(key === 'y' || event.shiftKey ? 'redo' : 'undo')
        }
        if (key === 'o') { event.preventDefault(); openProject() }
        if (key === 's') { event.preventDefault(); writeProject() }
        return
      }
      if (workspace === 'inspect' && key in toolKeys) setTool(toolKeys[key])
      if (key === 'f') { cameraMoved.current = true; viewport.current?.focus(); setView('orbit') }
      if (key === 'escape') {
        if (focused) setFocused(false)
        else choose(null)
      }
      if (key === ' ' && event.shiftKey) {
        event.preventDefault()
        setFocused((active) => !active)
        return
      }
      if (key === ' ' && !event.target.closest('button')) {
        event.preventDefault()
        togglePlayback()
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  })

  useEffect(() => {
    if (!notice) return
    const timeout = setTimeout(() => setNotice(''), 3200)
    return () => clearTimeout(timeout)
  }, [notice])

  function changeView(name) {
    cameraMoved.current = name !== 'perspective'
    viewport.current?.view(name)
    setView(name)
  }

  async function exportScene() {
    if (!viewport.current || exporting) return
    setExporting(true)
    setNotice('')
    try {
      await viewport.current.export({
        service: workspace === 'service',
        pick: workspace === 'pick',
        clipName: workspace === 'teach' ? 'Taught UR10e motion' : workspace === 'pick' ? 'UR10e pick and place' : 'UR10e motion preview',
        duration: workspace === 'teach' && taught.length < 2 ? 0 : lastFrame,
        sample: (at) => sampleProgram(program, at),
      })
      setNotice(workspace === 'service' ? 'Concept joint drive exported as GLB.' : 'UR10e exported as GLB.')
    } catch (failure) {
      console.error(failure)
      setNotice('The GLB export failed. Please try again.')
    } finally {
      setExporting(false)
    }
  }

  function toggle(set, id) {
    set((list) => list.includes(id) ? list.filter((item) => item !== id) : [...list, id])
  }

  const transform = ready ? viewport.current?.read(selected) : null
  const showViewportPanel = measure || section.enabled
  const inspectorVisible = dock && !focused
  const hasTimeline = workspace !== 'cad' && workspace !== 'service'
  const lowerDockVisible = !focused && (hasTimeline ? timeline : workspace === 'service')
  const isCad = workspace === 'cad'
  const currentPart = selected ? parts[selected]?.name : null
  const stateLabel = error ? 'Viewport unavailable' : !ready ? 'Loading model' : cadBuilding && isCad ? 'Building solid' : playing ? 'Playing' : 'Ready'

  return (
    <div className={`app ${focused ? 'viewport-focused' : ''}`}>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="identity"><span className="brand-icon"><Boxes size={22} strokeWidth={1.8} /></span><span>Assembly<span className="brand-accent">.</span>Lab</span></div>
          <div className="header-divider" />
          <div className="document-title">
            <span className="document-type">{isCad ? 'PART DESIGN' : 'ROBOT WORKCELL'}</span>
            <h1>{isCad ? (cadSource === 'trace' ? 'Traced Part Workbench' : 'Flange Adapter Workbench') : 'UR10e Collaborative Robot'}</h1>
          </div>
          <div className="header-actions">
            <input ref={fileInput} type="file" hidden accept=".assemblylab,application/json" onChange={(event) => {
              const file = event.target.files[0]
              event.target.value = ''
              if (file) openProject(file)
            }} />
            <IconButton label="Open project" disabled={!ready || projectBusy} onClick={() => openProject()}><FolderOpen size={17} /></IconButton>
            <IconButton label="Save project" disabled={!ready || projectBusy || adapterBuilding} onClick={writeProject}><Save size={17} /></IconButton>
            <span className="header-divider action-divider" />
            <IconButton label="Controls" onClick={() => dialog.current.showModal()}><CircleHelp size={17} /></IconButton>
            <IconButton label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} aria-pressed={fullscreen} onClick={toggleFullscreen}>
              {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </IconButton>
            <Button variant="outline" aria-label={workspace === 'cad' ? 'Export STEP' : 'Export GLB'} onClick={workspace === 'cad' ? exportAdapter : exportScene} disabled={!ready || exporting || (workspace === 'cad' && (cadBuilding || stepExporting || Boolean(cadError) || (cadSource === 'trace' && !traceSpec)))} className="export-button"><Download size={16} /><span>{exporting || stepExporting ? 'Exporting…' : workspace === 'cad' ? 'Export STEP' : 'Export GLB'}</span></Button>
          </div>
        </div>
      </header>

      <main className="workspace">
        <div className="workspace-bar">
          <nav className="mode-nav" aria-label="Workbench modes">
            {modes.map(({ id, label, compact, icon: Icon }) =>
              <Button key={id} variant="ghost" aria-label={label} aria-pressed={workspace === id} onClick={() => switchWorkspace(id)}>
                <Icon size={15} /><span className={compact && compact !== label ? 'mode-label-wide' : undefined}>{label}</span>
                {compact && compact !== label && <span className="mode-label-compact" aria-hidden="true">{compact}</span>}
              </Button>
            )}
          </nav>
          <div className="workspace-actions">
            {hasTimeline && <Button className="primary-play" onClick={togglePlayback} disabled={!canPlay}
              aria-label={playing ? 'Pause motion' : 'Play motion'}>
              {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
              <span>{playing ? 'Pause' : 'Play motion'}</span>
            </Button>}
            {hasTimeline && <IconButton label={timeline && !focused ? 'Hide timeline' : 'Show timeline'} aria-pressed={timeline && !focused}
              onClick={() => { setTimeline(focused ? true : !timeline); setFocused(false) }}><PanelBottom size={17} /></IconButton>}
            <IconButton label={inspectorVisible ? 'Hide inspector' : 'Show inspector'} aria-pressed={inspectorVisible}
              onClick={() => { setDock(!inspectorVisible); setFocused(false) }}><PanelRight size={17} /></IconButton>
          </div>
        </div>
        <div className={`workbench ${inspectorVisible ? 'has-sidebar' : ''}`} style={{ '--sidebar-width': `${sidebarWidth}px` }}>
          <div className="workbench-main">
            <section className={`viewport panel ${workspace === 'cad' ? 'cad-viewport' : ''}`} aria-label="3D viewport">
              <div className="viewport-header">
                <div className="viewport-title"><Box size={15} /><h2>3D Viewport</h2></div>
                <div className="viewport-actions">
                  <IconButton label="Undo" onClick={() => moveHistory('undo')} disabled={adapterBuilding || !history.current.undo.length}><Undo2 size={16} /></IconButton>
                  <IconButton label="Redo" onClick={() => moveHistory('redo')} disabled={adapterBuilding || !history.current.redo.length}><Redo2 size={16} /></IconButton>
                  <span className="vertical-rule" />
                  <IconButton label="Snap transforms" aria-pressed={snap} onClick={() => setSnap(!snap)} title="Snap move 5 mm, rotate 5°, scale 0.1"><Magnet size={16} /></IconButton>
                  <IconButton label="Measure distance" aria-pressed={measure} onClick={() => { if (!measure) showInspector(); setMeasure(!measure) }}><Ruler size={16} /></IconButton>
                  <IconButton label="Section view" aria-pressed={section.enabled} onClick={() => { if (!section.enabled) showInspector(); setSection({ ...section, enabled: !section.enabled }) }}><Scissors size={16} /></IconButton>
                  {workspace === 'inspect' && <Button className="explode-button" aria-label="Explode" size="sm" variant="ghost" aria-pressed={explosion > 0} disabled={!ready} onClick={() => changeExplosion(explosion > 0 ? 0 : 1, !cameraMoved.current)}><Expand size={15} /><span>Explode</span></Button>}
                  <span className="vertical-rule" />
                  <IconButton label={grid ? 'Hide grid' : 'Show grid'} aria-pressed={grid} onClick={() => setGrid(!grid)}><Grid2X2 size={16} /></IconButton>
                  {workspace === 'inspect' && <IconButton label={wireframe ? 'Switch to solid view' : 'Switch to wireframe'} aria-pressed={wireframe} onClick={() => setWireframe(!wireframe)}><Layers3 size={17} /></IconButton>}
                  <span className="vertical-rule" />
                  <IconButton label="Reset view" onClick={() => changeView('perspective')}><RotateCcw size={16} /></IconButton>
                  <IconButton label={focused ? 'Restore layout (Shift+Space)' : 'Maximize viewport (Shift+Space)'} aria-pressed={focused}
                    onClick={() => setFocused(!focused)}>{focused ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</IconButton>
                </div>
              </div>
              <div className="render-area">
                <div className="canvas-mount" ref={mount} />
                {workspace === 'cad' && cadBuilding && <span role="status" className="cad-loading">Building solid…</span>}
                {!ready && <div className="render-error" role="status">{error ? 'The UR10e model could not load. Reload the page in a browser with WebGL 2 enabled.' : 'Loading UR10e CAD…'}</div>}
                {workspace === 'inspect' && explosion > 0 && <label className="explosion-slider">Separation <input type="range" aria-label="Part separation" min="0.05" max="1" step="0.01" value={explosion} onChange={(event) => changeExplosion(Number(event.target.value))} /></label>}
                {(workspace === 'inspect' || workspace === 'teach') && isolated && <button className="isolation-chip" onClick={() => setIsolated(null)}><Focus size={13} /> {parts[isolated].name} isolated <X size={13} /></button>}
                <div className="viewport-overlay">
                  <span className="view-label">{viewLabels[view]} <i /> {section.enabled ? 'Section' : workspace === 'service' ? 'Cutaway' : workspace === 'inspect' && wireframe ? 'Wireframe' : 'Solid'}</span>
                  {workspace === 'inspect' && <div className="tool-dock" aria-label="Transform tools">
                    {tools.map(({ id, icon: Icon, label, key }) =>
                      <IconButton key={id} label={`${label} (${key})`} aria-pressed={tool === id} onClick={() => setTool(id)}><Icon size={17} /></IconButton>
                    )}
                    <span className="dock-rule" />
                    <IconButton label="Focus selected (F)" disabled={!ready || !selected} onClick={() => { cameraMoved.current = true; viewport.current?.focus(); setView('orbit') }}><Focus size={17} /></IconButton>
                  </div>}
                </div>
                <div className="orientation" aria-label="Camera views">
                  <svg viewBox="0 0 84 76" aria-hidden="true"><path d="M40 40V15 M40 40L69 49 M40 40L17 61" /><circle cx="40" cy="40" r="3" /></svg>
                  <button className="orient-y" title="Top view" aria-label="Top view" onClick={() => changeView('top')}>Y</button>
                  <button className="orient-x" title="Right view" aria-label="Right view" onClick={() => changeView('right')}>X</button>
                  <button className="orient-z" title="Front view" aria-label="Front view" onClick={() => changeView('front')}>Z</button>
                </div>
                <div className="viewport-hints mouse-hints"><span>Drag <b>Orbit</b></span><i /><span>Scroll <b>Zoom</b></span><i /><span>Right drag <b>Pan</b></span></div>
                <div className="viewport-hints touch-hints"><span>Drag <b>Orbit</b></span><i /><span>Pinch <b>Zoom</b></span><i /><span>2 fingers <b>Pan</b></span></div>
              </div>
            </section>

            {!lowerDockVisible ? null : workspace === 'service' ? <ServiceFooter joint={serviceJoint} /> : <Timeline frame={frame} playing={playing} setFrame={seek}
              setPlaying={(value) => value ? togglePlayback() : setPlaying(false)} lastFrame={lastFrame} canPlay={canPlay}
              trackName={workspace === 'teach' ? 'Taught poses' : workspace === 'pick' ? 'Pick & place' : 'Joint motion'}
              markers={workspace === 'teach' ? taught.map((key) => ({ ...key, name: 'Saved pose' })) : program}
            />}
          </div>

          {inspectorVisible && <div className="dock-splitter" role="separator" aria-orientation="vertical" aria-label="Resize inspector"
            aria-valuemin={sidebarMin} aria-valuemax={sidebarMax} aria-valuenow={sidebarWidth} tabIndex={0}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              splitterDrag.current = { x: event.clientX, width: sidebarWidth }
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={resizeDock}
            onLostPointerCapture={() => { splitterDrag.current = null }}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              setSidebarWidth((width) => clampSidebar(event.key === 'Home' ? sidebarMin : event.key === 'End' ? sidebarMax : width + (event.key === 'ArrowLeft' ? 16 : -16)))
            }}
          />}
          <aside className="sidebar" aria-label="Workbench inspector" hidden={!inspectorVisible}>
            {showViewportPanel && <ViewPanel measure={measure} result={measurement} clearMeasurement={() => viewport.current?.clearMeasurement()} section={section} setSection={setSection} />}
            {workspace === 'cad' && <div className="cad-source section-axes" aria-label="Part source">
              {[['adapter', 'Flange adapter'], ['trace', 'Trace image']].map(([id, label]) =>
                <Button key={id} size="sm" variant="outline" aria-pressed={cadSource === id} onClick={() => setCadSource(id)}>{label}</Button>)}
            </div>}
            {workspace === 'cad' && cadSource === 'adapter' && <CadPanel dimensions={dimensions} onApply={applyDimensions} onExport={exportAdapter}
              building={cadBuilding || !ready} exporting={stepExporting} error={cadError} />}
            {traceOpened && <div hidden={workspace !== 'cad' || cadSource !== 'trace'}>
              <Suspense fallback={<p className="mode-copy">Loading trace tools…</p>}>
                <TracePanel {...traced.panelProps} onBuild={traced.build} onExport={exportAdapter} building={cadBuilding || !ready} exporting={stepExporting}
                  error={cadSource === 'trace' ? cadError : ''} upToDate={traced.traceUpToDate && !cadBuilding && !cadError} />
              </Suspense>
            </div>}
            {(workspace === 'teach' || workspace === 'pick') && <ToolFrame values={toolValues} axes={showAxes} setAxes={setShowAxes} pick={workspace === 'pick'} />}
            {workspace === 'teach' && <TeachPanels {...{ pose, setJoint, frame, ready }} keys={taught} onSeek={(at) => { setPlaying(false); seek(at) }} onSave={savePose} onDelete={deletePose} />}
            {workspace === 'pick' && <PickPanel frame={frame} seek={(at) => { setPlaying(false); seek(at) }} />}
            {workspace === 'service' && <ServicePanels joint={serviceJoint} setJoint={setServiceJoint} separation={separation} setSeparation={setSeparation}
              selected={servicePart} changeSelected={setServicePart} hidden={serviceHidden} toggleHidden={(id) => toggle(setServiceHidden, id)} />}
            {workspace === 'inspect' && <>
            <section className="panel hierarchy">
              <div className="panel-heading"><Layers3 size={17} /><h2>Scene Hierarchy</h2><span className="object-count">{meshCount} parts</span></div>
              <div className="tree-scroll">
                <SceneTree nodes={hierarchy} {...{ selected, expanded, hidden, visible }} onSelect={choose}
                  onExpand={(id) => toggle(setExpanded, id)} onVisibility={(id) => {
                    const next = hidden.includes(id) ? hidden.filter((key) => key !== id) : [...hidden, id]
                    recordChange({ type: 'visibility', label: 'part visibility', before: hidden, after: next })
                    setIsolated(null)
                    setHidden(next)
                  }} />
              </div>
            </section>
            <Inspector {...{ selected, transform, viewport, pose, setJoint, isolated, setIsolated }} onSelect={choose} />
            </>}
          </aside>
        </div>

        <footer className="workspace-footer">
          <div className="status-group">
            <span><i className={`footer-dot ${error ? 'error' : !ready || (cadBuilding && isCad) ? 'pending' : ''}`} />{stateLabel}</span>
            <span className="status-context">{isCad ? 'Parametric solid' : workspace === 'service' ? 'Concept drive' : currentPart && workspace === 'inspect' ? currentPart + ' selected' : 'UR10e · 6 axes'}</span>
          </div>
          <div className="status-group">
            <span className="status-platform">{desktop ? 'Desktop' : 'Web'}</span>
            <span>mm</span>
            <a href={sourceUrl} target="_blank" rel="noreferrer">CAD source</a>
          </div>
        </footer>
      </main>

      <dialog ref={dialog} className="help-dialog" onClick={(event) => { if (event.target === dialog.current) dialog.current.close() }}>
        <div className="dialog-content">
          <div className="dialog-heading"><h2>Workbench controls</h2><IconButton label="Close controls" onClick={() => dialog.current.close()}><X size={18} /></IconButton></div>
          <dl>
            <div><dt>Orbit / Pan / Zoom</dt><dd>Drag / Right drag / Scroll</dd></div>
            <div><dt>Select</dt><dd>Click a part or press <kbd>V</kbd></dd></div>
            <div><dt>Move / Rotate / Scale</dt><dd><kbd>G</kbd> <kbd>R</kbd> <kbd>S</kbd></dd></div>
            <div><dt>Frame selected object</dt><dd><kbd>F</kbd></dd></div>
            <div><dt>Play or pause motion</dt><dd><kbd>Space</kbd></dd></div>
            <div><dt>Maximize the viewport</dt><dd><kbd>Shift</kbd> <kbd>Space</kbd></dd></div>
            <div><dt>Undo / Redo</dt><dd><kbd>Ctrl/⌘ Z</kbd> <kbd>Ctrl/⌘ ⇧ Z</kbd></dd></div>
            <div><dt>Open / Save project</dt><dd><kbd>Ctrl/⌘ O</kbd> <kbd>Ctrl/⌘ S</kbd></dd></div>
          </dl>
          <p className="model-credit">CAD kernel <a href="https://github.com/sgenoud/replicad/tree/5e4ad9bb5a35bb9ae0571e91c25fa1897ba0570c" target="_blank" rel="noreferrer">Replicad and Open CASCADE build source</a>. <a href={import.meta.env.BASE_URL + 'licenses/replicad-MIT.txt'} target="_blank" rel="noreferrer">MIT notice</a> · <a href={import.meta.env.BASE_URL + 'licenses/opencascade-LGPL-2.1.txt'} target="_blank" rel="noreferrer">LGPL notice</a>.</p>
          <p className="model-credit">UR10e external meshes and nominal joint frames from <a href={sourceUrl} target="_blank" rel="noreferrer">Universal Robots’ ROS 2 description</a>. <a href={licenseUrl} target="_blank" rel="noreferrer">BSD 3-Clause notice</a>.</p>
          <p className="model-credit">Hand-E visual meshes from <a href={gripperSource} target="_blank" rel="noreferrer">Robotiq’s ROS 2 description</a>. <a href={gripperLicense} target="_blank" rel="noreferrer">BSD 3-Clause notice</a>.</p>
        </div>
      </dialog>
      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  )
}
