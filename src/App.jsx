import { useEffect, useRef, useState } from 'react'
import {
  Axis3D, Box, Boxes, ChevronDown, ChevronRight, CircleHelp, Download, Eye, EyeOff,
  Focus, Grid2X2, Layers3, Maximize, MousePointer2, Move, Pause, Play, RotateCcw,
  RotateCw, ScanLine, SkipBack, SkipForward, SlidersHorizontal, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { hierarchy, defaultOpen } from './factory'
import { createViewport, keyframes } from './viewport'

const tools = [
  { id: 'select', icon: MousePointer2, label: 'Select', key: 'V' },
  { id: 'translate', icon: Move, label: 'Move', key: 'G' },
  { id: 'rotate', icon: RotateCw, label: 'Rotate', key: 'R' },
  { id: 'scale', icon: Maximize, label: 'Scale', key: 'S' },
]
const toolKeys = Object.fromEntries(tools.map((tool) => [tool.key.toLowerCase(), tool.id]))
const viewLabels = { perspective: 'Perspective', orbit: 'Perspective', top: 'Top', front: 'Front', right: 'Right' }
const fps = 30
const lastFrame = keyframes.at(-1).frame

function indexTree(nodes, parents = []) {
  const entries = nodes.flatMap((node) => [
    [node.id, { ...node, parents }],
    ...indexTree(node.children ?? [], [...parents, node.id]),
  ])
  return entries
}

const parts = Object.fromEntries(indexTree(hierarchy))

function IconButton({ label, children, className, ...props }) {
  return <Button size="icon" variant="ghost" aria-label={label} title={label} className={className} {...props}>{children}</Button>
}

function SceneTree({ nodes, level = 0, selected, expanded, hidden, onSelect, onExpand, onVisibility }) {
  return (
    <ul className="scene-list">
      {nodes.map((node) => {
        const open = expanded.includes(node.id)
        const concealed = hidden.includes(node.id)
        const visible = !concealed && parts[node.id].parents.every((parent) => !hidden.includes(parent))
        const PartIcon = node.children ? (node.id === 'robot' || node.id === 'vehicle' ? Boxes : Layers3) : Box
        return (
          <li key={node.id}>
            <div className={`tree-row ${selected === node.id ? 'selected' : ''} ${visible ? '' : 'concealed'}`} style={{ '--depth': level }}>
              {node.children
                ? <IconButton label={`${open ? 'Collapse' : 'Expand'} ${node.name}`} className="tree-toggle" aria-expanded={open} onClick={() => onExpand(node.id)}>{open ? <ChevronDown /> : <ChevronRight />}</IconButton>
                : <span className="tree-spacer" />}
              <button className="tree-label" onClick={() => onSelect(node.id)} aria-pressed={selected === node.id}>
                <PartIcon size={14} /><span>{node.name}</span>
              </button>
              <IconButton label={`${concealed ? 'Show' : 'Hide'} ${node.name}`} className="tree-eye" onClick={() => onVisibility(node.id)}>
                {concealed ? <EyeOff /> : <Eye />}
              </IconButton>
            </div>
            {node.children && open && <SceneTree nodes={node.children} level={level + 1} {...{ selected, expanded, hidden, onSelect, onExpand, onVisibility }} />}
          </li>
        )
      })}
    </ul>
  )
}

function NumberField({ value, axis, name, onCommit }) {
  const [draft, setDraft] = useState(null)
  const canceled = useRef(false)
  const display = value.toFixed(2)
  return (
    <label className="number-field">
      <span className={`axis axis-${axis}`}>{axis.toUpperCase()}</span>
      <input aria-label={`${name} ${axis.toUpperCase()}`} inputMode="decimal" value={draft ?? display}
        onFocus={(event) => { canceled.current = false; event.target.select() }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const parsed = Number(draft)
          if (!canceled.current && draft?.trim() && Number.isFinite(parsed)) onCommit(parsed)
          setDraft(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.target.blur()
          if (event.key === 'Escape') {
            canceled.current = true
            event.target.blur()
          }
        }}
      />
    </label>
  )
}

function Inspector({ selected, transform, viewport }) {
  return (
    <section className="panel inspector">
      <div className="panel-heading"><SlidersHorizontal size={16} /><h2>Properties</h2></div>
      {selected && transform ? (
        <div className="properties" key={selected}>
          <div className="object-heading">
            <span className="object-icon"><Box size={17} /></span>
            <div><h3>{parts[selected].name}</h3><p>Object3D</p></div>
          </div>
          <div className="section-line">
            <h4>Transform</h4>
            <IconButton label="Reset selected transform" onClick={() => viewport.current?.reset(selected)}><RotateCcw size={14} /></IconButton>
          </div>
          {[['position', 'Location', 'm'], ['rotation', 'Rotation', '°'], ['scale', 'Scale', null]].map(([type, label, unit]) => (
            <div className="transform-group" key={type}>
              <div className="field-label">{label}{unit && <span>{unit}</span>}</div>
              <div className="number-grid">
                {['x', 'y', 'z'].map((axis, index) =>
                  <NumberField key={axis} axis={axis} name={label} value={transform[type][index]} onCommit={(value) => viewport.current?.write(selected, type, axis, value)} />
                )}
              </div>
            </div>
          ))}
          <p className="coordinate-note"><Axis3D size={13} /> Local coordinates</p>
        </div>
      ) : <p className="empty-properties">Select a part in the viewport or scene hierarchy to edit its transform.</p>}
    </section>
  )
}

function Timeline({ frame, playing, setFrame, setPlaying }) {
  const track = useRef(null)
  function seek(event) {
    const rect = track.current.getBoundingClientRect()
    setFrame(Math.max(0, Math.min(lastFrame, Math.round((event.clientX - rect.left) / rect.width * lastFrame))))
  }
  return (
    <section className="panel timeline">
      <div className="timeline-heading">
        <div className="panel-heading"><ScanLine size={16} /><h2>Timeline</h2></div>
        <div className="playback">
          <IconButton label="First frame" onClick={() => { setPlaying(false); setFrame(0) }}><SkipBack size={14} /></IconButton>
          <IconButton label={playing ? 'Pause cycle' : 'Play cycle'} className="mini-play" onClick={() => setPlaying(!playing)}>{playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}</IconButton>
          <IconButton label="Last frame" onClick={() => { setPlaying(false); setFrame(lastFrame) }}><SkipForward size={14} /></IconButton>
        </div>
        <div className="frame-count"><strong>{String(frame).padStart(3, '0')}</strong> / {lastFrame}<span>{fps} FPS</span></div>
      </div>
      <div className="timeline-content">
        <span className="track-label">Assembly cycle</span>
        <div className="ruler" ref={track}>
          <div className="ruler-scrub" role="slider" tabIndex={0} aria-label="Animation frame" aria-valuemin={0} aria-valuemax={lastFrame} aria-valuenow={frame}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              setPlaying(false)
              seek(event)
            }}
            onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) seek(event) }}
            onKeyDown={(event) => {
              const changes = { ArrowLeft: frame - 1, ArrowRight: frame + 1, Home: 0, End: lastFrame }
              if (!(event.key in changes)) return
              event.preventDefault()
              setPlaying(false)
              setFrame(Math.max(0, Math.min(lastFrame, changes[event.key])))
            }}
          />
          {keyframes.map((item) => (
            <div key={item.frame} className="keyframe" style={{ left: `${item.frame / lastFrame * 100}%` }}>
              <span>{item.frame}</span>
              <button aria-label={`${item.name}, frame ${item.frame}`} title={item.name} onClick={() => { setPlaying(false); setFrame(item.frame) }}><i /></button>
            </div>
          ))}
          <div className="playhead" style={{ left: `${frame / lastFrame * 100}%` }} />
        </div>
      </div>
    </section>
  )
}

export default function App() {
  const mount = useRef(null)
  const viewport = useRef(null)
  const dialog = useRef(null)
  const [selected, setSelected] = useState('upper')
  const [expanded, setExpanded] = useState(defaultOpen)
  const [hidden, setHidden] = useState([])
  const [tool, setTool] = useState('select')
  const [view, setView] = useState('perspective')
  const [wireframe, setWireframe] = useState(false)
  const [grid, setGrid] = useState(true)
  const [transformVersion, setTransformVersion] = useState(0)
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState(false)
  const frameRef = useRef(0)

  function choose(id) {
    setSelected(id)
    if (id) setExpanded((open) => [...new Set([...open, ...parts[id].parents])])
  }

  useEffect(() => {
    try {
      const api = createViewport(mount.current, {
        onSelect: choose,
        onChange: () => setTransformVersion((version) => version + 1),
        onOrbit: () => setView('orbit'),
      })
      viewport.current = api
      setTransformVersion((version) => version + 1)
      return () => { api.dispose(); viewport.current = null }
    } catch (failure) {
      console.error(failure)
      setError(true)
    }
  }, [])

  useEffect(() => { viewport.current?.select(selected, tool) }, [selected, tool])
  useEffect(() => { viewport.current?.setVisibility(hidden) }, [hidden])
  useEffect(() => { viewport.current?.setWireframe(wireframe) }, [wireframe])
  useEffect(() => { viewport.current?.setGrid(grid) }, [grid])
  useEffect(() => { viewport.current?.setFrame(frame); frameRef.current = frame }, [frame])

  useEffect(() => {
    if (!playing) return
    const start = performance.now() - (frameRef.current % lastFrame) / fps * 1000
    let request
    function tick(now) {
      setFrame(Math.floor((now - start) / 1000 * fps) % lastFrame)
      request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [playing])

  useEffect(() => {
    function shortcut(event) {
      if (dialog.current?.open || event.altKey || event.metaKey || event.ctrlKey || event.target.closest('input, select, [role="slider"]')) return
      const key = event.key.toLowerCase()
      if (key in toolKeys) setTool(toolKeys[key])
      if (key === 'f') { viewport.current?.focus(); setView('orbit') }
      if (key === 'escape') choose(null)
      if (key === ' ' && !event.target.closest('button')) {
        event.preventDefault()
        if (!error) setPlaying((value) => !value)
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [error])

  useEffect(() => {
    if (!notice) return
    const timeout = setTimeout(() => setNotice(''), 3200)
    return () => clearTimeout(timeout)
  }, [notice])

  function changeView(name) {
    viewport.current?.view(name)
    setView(name)
  }

  async function exportScene() {
    if (!viewport.current || exporting) return
    setExporting(true)
    setNotice('')
    try {
      await viewport.current.export()
      setNotice('Assembly cell exported as GLB.')
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

  const transform = transformVersion > 0 ? viewport.current?.read(selected) : null

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="identity"><span className="brand-icon"><Boxes size={22} strokeWidth={1.8} /></span><span>Assembly<span className="brand-accent">.</span>Lab</span></div>
          <div className="header-divider" />
          <span className="header-context">3D WORKBENCH</span>
          <div className="header-actions">
            <Button variant="ghost" aria-label="Controls" onClick={() => dialog.current.showModal()} className="help-button"><CircleHelp size={17} /><span>Controls</span></Button>
            <Button variant="outline" onClick={exportScene} disabled={error || exporting} className="export-button"><Download size={16} /><span>{exporting ? 'Exporting…' : 'Export GLB'}</span></Button>
          </div>
        </div>
      </header>

      <main className="workspace">
        <div className="scene-intro">
          <div>
            <div className="eyebrow"><span /> AUTOMOTIVE / CELL 01</div>
            <h1>Robotic Assembly Cell</h1>
            <p>Explore the station, isolate components, and run the assembly cycle.</p>
          </div>
          <Button className="primary-play" onClick={() => setPlaying(!playing)} disabled={error}>
            {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
            {playing ? 'Pause cycle' : 'Play cycle'}
          </Button>
        </div>

        <div className="workbench">
          <div className="workbench-main">
            <section className="viewport panel" aria-label="3D viewport">
              <div className="viewport-header">
                <div className="viewport-title"><Box size={16} /><h2>3D Viewport</h2></div>
                <div className="viewport-actions">
                  <IconButton label={grid ? 'Hide grid' : 'Show grid'} aria-pressed={grid} onClick={() => setGrid(!grid)}><Grid2X2 size={16} /></IconButton>
                  <IconButton label={wireframe ? 'Switch to solid view' : 'Switch to wireframe'} aria-pressed={wireframe} onClick={() => setWireframe(!wireframe)}><Layers3 size={17} /></IconButton>
                  <span className="vertical-rule" />
                  <IconButton label="Reset view" onClick={() => changeView('perspective')}><RotateCcw size={16} /></IconButton>
                </div>
              </div>
              <div className="render-area">
                <div className="canvas-mount" ref={mount} />
                {error && <div className="render-error">WebGL 2 is unavailable. Open this workbench in a browser with hardware acceleration enabled.</div>}
                <div className="viewport-overlay">
                  <span className="view-label">{viewLabels[view]} <i /> {wireframe ? 'Wireframe' : 'Solid'}</span>
                  <div className="tool-dock" aria-label="Transform tools">
                    {tools.map(({ id, icon: Icon, label, key }) =>
                      <IconButton key={id} label={`${label} (${key})`} aria-pressed={tool === id} onClick={() => setTool(id)}><Icon size={17} /></IconButton>
                    )}
                    <span className="dock-rule" />
                    <IconButton label="Focus selected (F)" disabled={!selected} onClick={() => { viewport.current?.focus(); setView('orbit') }}><Focus size={17} /></IconButton>
                  </div>
                </div>
                <div className="orientation" aria-label="Camera views">
                  <svg viewBox="0 0 84 76" aria-hidden="true"><path d="M40 40V15 M40 40L69 49 M40 40L17 61" /><circle cx="40" cy="40" r="3" /></svg>
                  <button className="orient-y" title="Top view" aria-label="Top view" onClick={() => changeView('top')}>Y</button>
                  <button className="orient-x" title="Right view" aria-label="Right view" onClick={() => changeView('right')}>X</button>
                  <button className="orient-z" title="Front view" aria-label="Front view" onClick={() => changeView('front')}>Z</button>
                </div>
                <div className="viewport-hints mouse-hints"><span>Drag <b>Orbit</b></span><i /><span>Scroll <b>Zoom</b></span><i /><span>Right drag <b>Pan</b></span></div>
                <div className="viewport-hints touch-hints"><span>Drag <b>Orbit</b></span><i /><span>Pinch <b>Zoom</b></span><i /><span>2 fingers <b>Pan</b></span></div>
                <div className="view-stage"><i /> {error ? 'VIEW UNAVAILABLE' : playing ? 'CYCLE RUNNING' : 'SCENE READY'}</div>
              </div>
            </section>

            <Timeline {...{ frame, playing, setFrame, setPlaying }} />
          </div>

          <aside className="sidebar">
            <section className="panel hierarchy">
              <div className="panel-heading"><Layers3 size={17} /><h2>Scene Hierarchy</h2><span className="object-count">{Object.keys(parts).length} objects</span></div>
              <div className="scene-root"><Boxes size={14} /> Assembly Cell</div>
              <div className="tree-scroll">
                <SceneTree nodes={hierarchy} {...{ selected, expanded, hidden }} onSelect={choose}
                  onExpand={(id) => toggle(setExpanded, id)} onVisibility={(id) => toggle(setHidden, id)} />
              </div>
            </section>
            <Inspector {...{ selected, transform, viewport }} />
          </aside>
        </div>

        <footer className="workspace-footer">
          <span><span className="footer-dot" /> {error ? 'WebGL unavailable' : 'Three.js workbench'}</span>
          <span>{selected ? `Selected · ${parts[selected].name}` : 'No selection'}</span>
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
            <div><dt>Play or pause cycle</dt><dd><kbd>Space</kbd></dd></div>
          </dl>
        </div>
      </dialog>
      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  )
}
