import { useEffect, useRef, useState } from 'react'
import { Box, CircleDot, Crop, Download, Eye, EyeOff, ImagePlus, MousePointer2, Ruler, RotateCcw, RotateCw, ScanLine, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { circleRadius, isRoundView, loopContains, regionBounds, traceImage, viewLabels, viewNames, viewScale } from './trace'
import { traceLimits } from './trace-spec'
import { withView } from './trace-state'
import { meshAccept } from './mesh-reference'
import { orderCorners, straightenImage } from './perspective'

const grab = 8

// Every editable point of a view: loop vertices and circle centres.
function handles(regions) {
  const list = []
  regions.forEach((region, regionIndex) => [region.outer, ...region.holes].forEach((loop, loopIndex) => {
    if (loop.circle) list.push({ regionIndex, loopIndex, pointIndex: -1, at: loop.circle })
    else loop.points.forEach((at, pointIndex) => list.push({ regionIndex, loopIndex, pointIndex, at }))
  }))
  return list
}

function nearestHandle(regions, [x, y], radius) {
  let best = null
  for (const handle of handles(regions)) {
    const distance = Math.hypot(handle.at[0] - x, handle.at[1] - y)
    if (distance <= radius && (!best || distance < best.distance)) best = { ...handle, distance }
  }
  return best
}

function nearestSegment(regions, [x, y], radius) {
  let best = null
  regions.forEach((region, regionIndex) => [region.outer, ...region.holes].forEach((loop, loopIndex) => {
    if (loop.circle) return
    loop.points.forEach((a, pointIndex) => {
      const b = loop.points[(pointIndex + 1) % loop.points.length]
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)))
      const distance = Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y)
      if (distance <= radius && (!best || distance < best.distance)) best = { regionIndex, loopIndex, pointIndex, distance }
    })
  }))
  return best
}

function editLoop(regions, { regionIndex, loopIndex }, change) {
  return regions.map((region, r) => {
    if (r !== regionIndex) return region
    const loops = [region.outer, ...region.holes].map((loop, l) => l === loopIndex ? change(loop) : loop)
    return { outer: loops[0], holes: loops.slice(1).filter(Boolean) }
  })
}

// A millimetre input that commits on Enter or blur, so typing makes one undo step.
function MmField({ label, value, min, max, onCommit, compact = false }) {
  const [draft, setDraft] = useState(null)
  const shown = draft ?? (Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '')
  function commit() {
    const number = Number(draft)
    if (draft !== null && draft.trim() && Number.isFinite(number) && number >= min && number <= max) onCommit(number)
    setDraft(null)
  }
  return (
    <label className={compact ? 'mm-field compact' : 'mm-field'}><span>{label}</span>
      <input type="number" inputMode="decimal" min={min} max={max} step="any" value={shown}
        onChange={(event) => setDraft(event.target.value)} onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') event.target.blur(); if (event.key === 'Escape') { setDraft(null); event.target.blur() } }} />
    </label>
  )
}

function MeshSection({ mesh, onImportMesh, onMeshSize, onMeshTurn, onMeshVisible, onMeshRemove, onViewsFromMesh }) {
  const input = useRef(null)
  const [busy, setBusy] = useState(false)
  async function run(action) {
    setBusy(true)
    try { await action() } finally { setBusy(false) }
  }
  return (
    <div className="trace-group trace-mesh">
      <h4>Reference mesh</h4>
      <input ref={input} type="file" accept={meshAccept} hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) run(() => onImportMesh(file)); event.target.value = '' }} />
      {!mesh && <>
        <p className="trace-note">Import a GLB, OBJ or STL, for example from an AI image-to-3D service or a scan, then turn it into front, right and top views.</p>
        <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={() => input.current.click()}><Box size={15} /> {busy ? 'Loading mesh…' : 'Import mesh'}</Button>
      </>}
      {mesh && <>
        <div className="trace-mesh-head">
          <div className="trace-mesh-name" title={mesh.name}><strong>{mesh.name}</strong><small>{Math.round(mesh.triangles).toLocaleString()} triangles · {mesh.size.map((value) => value.toFixed(1)).join(' × ')} mm</small></div>
          <Button type="button" size="icon" variant="ghost" aria-label={mesh.visible ? 'Hide reference mesh' : 'Show reference mesh'} onClick={() => onMeshVisible(!mesh.visible)}>{mesh.visible ? <Eye size={15} /> : <EyeOff size={15} />}</Button>
          <Button type="button" size="icon" variant="ghost" aria-label="Remove reference mesh" onClick={onMeshRemove}><Trash2 size={15} /></Button>
        </div>
        <MmField label="Longest side (mm)" value={mesh.longest} min={traceLimits.width[0]} max={traceLimits.width[1]} onCommit={onMeshSize} />
        <div className="trace-turns" aria-label="Turn mesh 90 degrees">
          <span>Turn 90°</span>
          {['x', 'y', 'z'].map((axis) => <Button key={axis} type="button" size="sm" variant="outline" aria-label={'Turn mesh 90 degrees around ' + axis.toUpperCase()} onClick={() => onMeshTurn(axis)}><RotateCw size={13} /> {axis.toUpperCase()}</Button>)}
        </div>
        <p className="trace-note">Turn the mesh until its front faces you and its top points up in the 3D view.</p>
        <Button type="button" className="w-full" disabled={busy} onClick={() => run(onViewsFromMesh)}><ScanLine size={15} /> {busy ? 'Making views…' : 'Make front, right and top views'}</Button>
        <Button type="button" variant="ghost" size="sm" className="w-full" disabled={busy} onClick={() => input.current.click()}>Replace mesh</Button>
      </>}
    </div>
  )
}

export function TracePanel({ trace, images, result, onChange, onLive, onImport, onStraighten, onBuild, onExport, building, exporting, error, upToDate, ...meshProps }) {
  const name = trace.view
  const view = trace.views[name]
  const image = view ? images[view.imageId] : null
  const scale = view ? viewScale(view) : null
  const [tool, setTool] = useState('edit')
  const [holeDiameter, setHoleDiameter] = useState(10)
  const [corners, setCorners] = useState([])
  const [rectangle, setRectangle] = useState({ width: NaN, height: NaN })
  const [straightening, setStraightening] = useState(false)
  const [straightenError, setStraightenError] = useState('')
  const canvas = useRef(null)
  const picture = useRef(null)
  const drag = useRef(null)
  const live = useRef(null)
  const fileInput = useRef(null)
  const redraw = useRef(null)

  useEffect(() => { setTool('edit') }, [name])
  useEffect(() => { setCorners([]); setStraightenError('') }, [name, image])

  async function straighten() {
    setStraightening(true)
    setStraightenError('')
    try {
      const { width, height } = rectangle
      const aspect = Number.isFinite(width) && Number.isFinite(height) ? width / height : null
      const straightened = await straightenImage(image, corners, aspect)
      onStraighten(name, straightened, Number.isFinite(width) ? width : null)
      setCorners([])
      setTool('edit')
    } catch (failure) {
      setStraightenError(failure?.message ?? String(failure))
    } finally {
      setStraightening(false)
    }
  }

  const setViewState = (change, label) => onChange(withView(trace, name, change), label)
  const setShape = (change, label) => onChange({ ...trace, shape: { ...trace.shape, ...change } }, label)

  // Sliders update live and record one undo step when released.
  function slide(change) {
    live.current ??= trace
    onLive(withView(trace, name, (current) => change(current)))
  }
  function release(label) {
    if (!live.current) return
    onChange(trace, label, live.current)
    live.current = null
  }
  const retrace = (current, settings) => ({ ...current, settings, regions: traceImage(image, settings), edited: false })
  const slider = (label) => ({ onPointerUp: () => release(label), onKeyUp: () => release(label), onBlur: () => release(label) })

  useEffect(() => {
    picture.current = null
    if (!image) return
    const element = new Image()
    element.onload = () => { picture.current = element; redraw.current?.() }
    element.src = image.url
  }, [image])

  function toImage(event) {
    const rect = canvas.current.getBoundingClientRect()
    const ratio = image.width / rect.width
    return { point: [(event.clientX - rect.left) * ratio, (event.clientY - rect.top) * ratio], ratio }
  }

  function draw() {
    const element = canvas.current
    if (!element || !image) return
    const dpr = window.devicePixelRatio || 1
    const width = element.clientWidth
    const height = width * image.height / image.width
    element.style.height = height + 'px'
    element.width = Math.round(width * dpr)
    element.height = Math.round(height * dpr)
    const context = element.getContext('2d')
    const zoom = element.width / image.width
    const px = 1 / zoom
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, element.width, element.height)
    context.globalAlpha = 0.55
    if (picture.current) context.drawImage(picture.current, 0, 0, element.width, element.height)
    context.globalAlpha = 1
    context.setTransform(zoom, 0, 0, zoom, 0, 0)
    const path = (loop) => {
      if (loop.circle) {
        const radius = circleRadius(loop, scale)
        context.moveTo(loop.circle[0] + radius, loop.circle[1])
        context.arc(loop.circle[0], loop.circle[1], radius, 0, Math.PI * 2)
      } else {
        loop.points.forEach(([x, y], index) => context[index ? 'lineTo' : 'moveTo'](x, y))
        context.closePath()
      }
    }
    if (trace.shape.mode === 'revolve' && name === 'front') {
      const bounds = regionBounds(view.regions)
      if (bounds) {
        const x = bounds.minX + (bounds.maxX - bounds.minX) * trace.shape.axis / 100
        context.fillStyle = 'rgba(20, 28, 40, 0.28)'
        context.fillRect(0, 0, x, image.height)
        context.save()
        context.setLineDash([6 * px, 4 * px])
        context.strokeStyle = '#e0526a'
        context.lineWidth = 1.5 * px
        context.beginPath()
        context.moveTo(x, 0)
        context.lineTo(x, image.height)
        context.stroke()
        context.restore()
      }
    }
    for (const region of view.regions) {
      context.beginPath()
      for (const loop of [region.outer, ...region.holes]) path(loop)
      context.fillStyle = 'rgba(77, 124, 255, 0.22)'
      context.fill('evenodd')
      ;[region.outer, ...region.holes].forEach((loop, index) => {
        const color = loop.circle ? '#13a37a' : index ? '#ef8a3c' : '#2f6bff'
        context.beginPath()
        path(loop)
        context.strokeStyle = color
        context.lineWidth = 1.6 * px
        context.stroke()
        context.fillStyle = color
        for (const [x, y] of loop.circle ? [loop.circle] : loop.points) {
          context.beginPath()
          context.arc(x, y, (loop.circle ? 3 : 2.3) * px, 0, Math.PI * 2)
          context.fill()
        }
      })
    }
    const marks = view.scale.mode === 'points' ? view.scale.points : []
    if (marks.length) {
      context.strokeStyle = '#d6336c'
      context.fillStyle = '#d6336c'
      context.lineWidth = 1.8 * px
      if (marks.length === 2) {
        context.beginPath()
        context.moveTo(...marks[0])
        context.lineTo(...marks[1])
        context.stroke()
      }
      for (const [x, y] of marks) {
        context.beginPath()
        context.moveTo(x - 6 * px, y)
        context.lineTo(x + 6 * px, y)
        context.moveTo(x, y - 6 * px)
        context.lineTo(x, y + 6 * px)
        context.stroke()
      }
    }
    if (tool === 'corners' && corners.length) {
      const shown = corners.length === 4 ? orderCorners(corners) : corners
      context.strokeStyle = '#a335d6'
      context.fillStyle = 'rgba(163, 53, 214, 0.12)'
      context.lineWidth = 1.8 * px
      context.beginPath()
      shown.forEach(([x, y], index) => context[index ? 'lineTo' : 'moveTo'](x, y))
      if (shown.length === 4) {
        context.closePath()
        context.fill()
      }
      context.stroke()
      context.fillStyle = '#a335d6'
      for (const [x, y] of shown) {
        context.beginPath()
        context.arc(x, y, 4 * px, 0, Math.PI * 2)
        context.fill()
      }
    }
  }
  redraw.current = draw
  useEffect(draw)
  useEffect(() => {
    const observer = new ResizeObserver(() => redraw.current?.())
    if (canvas.current) observer.observe(canvas.current)
    return () => observer.disconnect()
  }, [image])

  function pointerDown(event) {
    if (event.button !== 0) return
    const { point, ratio } = toImage(event)
    if (tool === 'corners') {
      const at = [Math.max(0, Math.min(image.width, point[0])), Math.max(0, Math.min(image.height, point[1]))]
      setCorners((list) => list.length >= 4 ? [at] : [...list, at])
      return
    }
    if (tool === 'scale') {
      const points = view.scale.points.length === 1 ? [view.scale.points[0], point] : [point]
      setViewState((current) => ({ ...current, scale: { ...current.scale, mode: 'points', points } }), 'scale points')
      if (points.length === 2) setTool('edit')
      return
    }
    if (tool === 'hole') {
      const region = view.regions.findIndex((item) => loopContains(item.outer, point, scale) && !item.holes.some((hole) => loopContains(hole, point, scale)))
      if (region < 0) return
      const radius = scale ? holeDiameter / 2 / scale : image.width * 0.03
      setViewState((current) => ({
        ...current,
        edited: true,
        regions: current.regions.map((item, index) => index === region ? { ...item, holes: [...item.holes, { circle: [point[0], point[1], radius], diameter: holeDiameter }] } : item),
      }), 'added hole')
      setTool('edit')
      return
    }
    const hit = nearestHandle(view.regions, point, grab * ratio)
    if (!hit) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { hit, before: trace, moved: false }
  }

  function pointerMove(event) {
    const { point, ratio } = toImage(event)
    if (!drag.current) {
      event.currentTarget.style.cursor = tool !== 'edit' ? 'crosshair'
        : nearestHandle(view.regions, point, grab * ratio) ? 'grab' : nearestSegment(view.regions, point, grab * ratio) ? 'copy' : 'default'
      return
    }
    const at = [Math.max(0, Math.min(image.width, point[0])), Math.max(0, Math.min(image.height, point[1]))]
    const { hit } = drag.current
    drag.current.moved = true
    onLive(withView(trace, name, (current) => ({
      ...current,
      edited: true,
      regions: editLoop(current.regions, hit, (loop) => loop.circle
        ? { ...loop, circle: [at[0], at[1], loop.circle[2]] }
        : { points: loop.points.map((p, index) => index === hit.pointIndex ? at : p) }),
    })))
  }

  function pointerUp() {
    if (drag.current?.moved) onChange(trace, 'moved point', drag.current.before)
    drag.current = null
  }

  function doubleClick(event) {
    if (tool !== 'edit') return
    const { point, ratio } = toImage(event)
    if (nearestHandle(view.regions, point, grab * ratio)) return
    const hit = nearestSegment(view.regions, point, grab * ratio)
    if (!hit) return
    setViewState((current) => ({
      ...current,
      edited: true,
      regions: editLoop(current.regions, hit, (loop) => ({ points: [...loop.points.slice(0, hit.pointIndex + 1), point, ...loop.points.slice(hit.pointIndex + 1)] })),
    }), 'added point')
  }

  function contextMenu(event) {
    const { point, ratio } = toImage(event)
    const hit = nearestHandle(view.regions, point, grab * ratio)
    if (!hit) return
    event.preventDefault()
    setViewState((current) => ({
      ...current,
      edited: true,
      regions: editLoop(current.regions, hit, (loop) => {
        if (loop.circle) return hit.loopIndex ? null : loop
        return loop.points.length > 3 ? { points: loop.points.filter((_, index) => index !== hit.pointIndex) } : loop
      }),
    }), 'removed point')
  }

  const circleHoles = view ? view.regions.flatMap((region, regionIndex) => region.holes
    .map((hole, holeIndex) => ({ hole, regionIndex, loopIndex: holeIndex + 1 })).filter(({ hole }) => hole.circle)) : []
  const pointCount = view ? handles(view.regions).length : 0
  const size = result.sizes?.[name]
  const multi = trace.shape.mode === 'extrude' && (trace.views.right?.regions.length || trace.views.top?.regions.length)
  const hints = {
    edit: 'Drag a point or circle centre · double-click a line to add a point · right-click to remove.',
    hole: 'Click inside the part to place a ' + holeDiameter + ' mm hole.',
    corners: corners.length < 4
      ? 'Click corner ' + (corners.length + 1) + ' of 4 of something truly rectangular: the paper, a drawing border or a square face.'
      : 'Enter the rectangle\'s real size if you know it, then straighten.',
    scale: view?.scale.points.length === 1 ? 'Click the second point of a known distance.' : 'Click the first point of a known distance.',
  }

  return (
    <section className="panel mode-panel">
      <div className="panel-heading mode-panel-title"><ScanLine size={16} /><h2>Trace from image</h2><span className="object-count">mm</span></div>
      <div className="mode-panel-body cad-form trace-form">
        <MeshSection {...meshProps} />
        <div className="section-axes trace-views" aria-label="Traced view">
          {viewNames.map((item) => <Button key={item} type="button" size="sm" variant="outline" aria-pressed={item === name}
            onClick={() => onLive({ ...trace, view: item })}>{viewLabels[item]}{trace.views[item] && <i className="trace-dot" aria-label="has image" />}</Button>)}
        </div>
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) onImport(name, file); event.target.value = '' }} />
        <div className="cad-buttons">
          <Button type="button" variant="outline" onClick={() => fileInput.current.click()}><ImagePlus size={15} /> {view ? 'Replace ' : 'Import '}{viewLabels[name].toLowerCase()} view</Button>
          <Button type="button" variant="outline" aria-label={'Remove ' + viewLabels[name].toLowerCase() + ' view'} title="Remove this view" disabled={!view}
            onClick={() => onChange(withView(trace, name, () => null), 'removed view')}><Trash2 size={15} /></Button>
        </div>
        {!view && <p className="mode-copy">{name === 'front'
          ? 'Use a straight-on photo, drawing or silhouette on a plain background. The front view alone makes an extruded or revolved part.'
          : 'Optional. Add a ' + name + ' view to carve the part from a second direction, like a three-view drawing.'}</p>}

        {view && <>
          <div className="trace-tools" aria-label="Preview tool">
            {[['edit', MousePointer2, 'Edit'], ['hole', CircleDot, 'Add hole'], ['scale', Ruler, 'Scale points'], ['corners', Crop, 'Straighten']].map(([id, Icon, label]) =>
              <Button key={id} type="button" size="sm" variant="ghost" aria-pressed={tool === id} onClick={() => setTool(tool === id ? 'edit' : id)}><Icon size={14} /> {label}</Button>)}
          </div>
          <div className="trace-preview">
            <canvas ref={canvas} aria-label={'Traced outline of ' + image.name} onPointerDown={pointerDown} onPointerMove={pointerMove}
              onPointerUp={pointerUp} onLostPointerCapture={pointerUp} onDoubleClick={doubleClick} onContextMenu={contextMenu} />
          </div>
          <p className="trace-hint">{hints[tool]}
            <span>{view.regions.length} {view.regions.length === 1 ? 'region' : 'regions'} · {pointCount} points{view.edited ? ' · edited' : ''}{size ? ' · ' + size.width.toFixed(1) + ' × ' + size.height.toFixed(1) + ' mm' : ''}</span></p>

          {tool === 'corners' && <div className="trace-group trace-straighten">
            <h4>Straighten photo <span className="trace-count">{corners.length}/4</span></h4>
            <p className="trace-note">For a photo taken at an angle. The picked rectangle becomes the whole image, so pick corners around the part, such as the sheet it lies on.</p>
            <div className="trace-scale-points">
              <MmField label="Real width (mm)" value={rectangle.width} min={traceLimits.width[0]} max={traceLimits.width[1]} onCommit={(width) => setRectangle({ ...rectangle, width })} />
              <MmField label="Real height (mm)" value={rectangle.height} min={traceLimits.width[0]} max={traceLimits.width[1]} onCommit={(height) => setRectangle({ ...rectangle, height })} />
            </div>
            <p className="trace-note">Optional. Both sizes give the exact proportions; the width also sets the scale. A4 is 210 × 297 mm.</p>
            {straightenError && <p className="cad-error" role="alert">{straightenError}</p>}
            <div className="cad-buttons">
              <Button type="button" disabled={corners.length !== 4 || straightening} onClick={straighten}><Crop size={15} /> {straightening ? 'Straightening…' : 'Straighten'}</Button>
              <Button type="button" variant="outline" disabled={!corners.length && !Number.isFinite(rectangle.width) && !Number.isFinite(rectangle.height)}
                onClick={() => { setCorners([]); setRectangle({ width: NaN, height: NaN }) }}>Clear</Button>
            </div>
          </div>}

          <div className="trace-group">
            <h4>Outline</h4>
            {image.hasAlpha && <label className="trace-check"><input type="checkbox" checked={view.settings.useAlpha}
              onChange={(event) => setViewState((current) => retrace(current, { ...current.settings, useAlpha: event.target.checked }), 'trace settings')} /> Use transparency as the outline</label>}
            {!view.settings.useAlpha && <label className="trace-range"><span>Threshold <output>{view.settings.threshold}</output></span>
              <input type="range" min="1" max="254" value={view.settings.threshold} {...slider('threshold')}
                onChange={(event) => slide((current) => retrace(current, { ...current.settings, threshold: Number(event.target.value) }))} /></label>}
            <label className="trace-check"><input type="checkbox" checked={view.settings.invert}
              onChange={(event) => setViewState((current) => retrace(current, { ...current.settings, invert: event.target.checked }), 'trace settings')} /> Invert (part is lighter than background)</label>
            <label className="trace-check"><input type="checkbox" checked={view.settings.circles}
              onChange={(event) => setViewState((current) => retrace(current, { ...current.settings, circles: event.target.checked }), 'trace settings')} /> Snap round outlines to true circles</label>
            <label className="trace-range"><span>Detail <output>{view.settings.tolerance <= 0.8 ? 'Fine' : view.settings.tolerance >= 3 ? 'Coarse' : 'Medium'}</output></span>
              <input type="range" min="0.4" max="6" step="0.1" value={6.4 - view.settings.tolerance} {...slider('detail')}
                onChange={(event) => slide((current) => retrace(current, { ...current.settings, tolerance: Math.round((6.4 - Number(event.target.value)) * 10) / 10 }))} /></label>
            <label className="trace-range"><span>Ignore specks under <output>{view.settings.minArea} px²</output></span>
              <input type="range" min="0" max="2000" step="10" value={view.settings.minArea} {...slider('speck size')}
                onChange={(event) => slide((current) => retrace(current, { ...current.settings, minArea: Number(event.target.value) }))} /></label>
            {view.edited && <p className="trace-note">Changing these settings retraces the image and replaces point and hole edits (undo brings them back).</p>}
          </div>

          <div className="trace-group">
            <h4>Scale</h4>
            <div className="section-axes trace-mode" aria-label="Scale method">
              {[['width', 'Overall width'], ['points', 'Two points']].map(([id, label]) =>
                <Button key={id} type="button" size="sm" variant="outline" aria-pressed={view.scale.mode === id}
                  onClick={() => { setViewState((current) => ({ ...current, scale: { ...current.scale, mode: id } }), 'scale method'); if (id === 'points' && view.scale.points.length < 2) setTool('scale') }}>{label}</Button>)}
            </div>
            {view.scale.mode === 'width'
              ? <MmField label="Real width of the outline (mm)" value={view.scale.width} min={traceLimits.width[0]} max={traceLimits.width[1]}
                onCommit={(width) => setViewState((current) => ({ ...current, scale: { ...current.scale, width } }), 'scale width')} />
              : <div className="trace-scale-points">
                <MmField label="Distance between points (mm)" value={view.scale.distance} min={traceLimits.width[0]} max={traceLimits.width[1]}
                  onCommit={(distance) => setViewState((current) => ({ ...current, scale: { ...current.scale, distance } }), 'scale distance')} />
                <Button type="button" size="sm" variant="outline" aria-pressed={tool === 'scale'} onClick={() => setTool(tool === 'scale' ? 'edit' : 'scale')}>
                  <Ruler size={14} /> {view.scale.points.length === 2 ? 'Re-pick' : 'Pick'}</Button>
              </div>}
            <p className="trace-note">{scale ? (1 / scale).toFixed(2) + ' px per mm' : view.scale.mode === 'points' ? 'Pick two points on a known distance.' : 'Enter the real width.'}</p>
          </div>

          <div className="trace-group">
            <h4>Round holes <span className="trace-count">{circleHoles.length}</span></h4>
            {circleHoles.length > 0 && <ul className="trace-holes">
              {circleHoles.map(({ hole, regionIndex, loopIndex }, index) => <li key={regionIndex + '-' + loopIndex}>
                <span title={hole.diameter ? 'Size is fixed in mm' : 'Size follows the image scale'}>Hole {index + 1}{hole.diameter ? '' : ' · traced'}</span>
                <MmField compact label="Ø mm" value={hole.diameter ?? (scale ? hole.circle[2] * 2 * scale : NaN)} min={0.1} max={traceLimits.width[1]}
                  onCommit={(diameter) => setViewState((current) => ({ ...current, edited: true,
                    regions: editLoop(current.regions, { regionIndex, loopIndex }, (loop) => ({ circle: [loop.circle[0], loop.circle[1], scale ? diameter / 2 / scale : loop.circle[2]], diameter })) }), 'hole diameter')} />
                <Button type="button" size="icon" variant="ghost" aria-label={'Remove hole ' + (index + 1)}
                  onClick={() => setViewState((current) => ({ ...current, edited: true, regions: editLoop(current.regions, { regionIndex, loopIndex }, () => null) }), 'removed hole')}><Trash2 size={14} /></Button>
              </li>)}
            </ul>}
            <div className="trace-scale-points">
              <MmField label="New hole Ø (mm)" value={holeDiameter} min={0.1} max={traceLimits.width[1]} onCommit={setHoleDiameter} />
              <Button type="button" size="sm" variant="outline" aria-pressed={tool === 'hole'} onClick={() => setTool(tool === 'hole' ? 'edit' : 'hole')}><CircleDot size={14} /> Place</Button>
            </div>
          </div>
        </>}

        <div className="trace-group">
          <h4>Solid</h4>
          <div className="section-axes trace-mode" aria-label="Solid type">
            {[['extrude', multi ? 'Extrude views' : 'Extrude'], ['revolve', 'Revolve']].map(([id, label]) =>
              <Button key={id} type="button" size="sm" variant="outline" aria-pressed={trace.shape.mode === id} onClick={() => setShape({ mode: id }, 'solid type')}>{label}</Button>)}
          </div>
          {trace.shape.mode === 'extrude' && !multi && <MmField label="Thickness (mm)" value={trace.shape.thickness} min={traceLimits.thickness[0]} max={traceLimits.thickness[1]}
            onCommit={(thickness) => setShape({ thickness }, 'thickness')} />}
          {trace.shape.mode === 'extrude' && isRoundView(trace.views.top) && <div className="trace-suggest">
            <p>The top view is round, so this looks like a turned part. Revolving the front view usually matches it more closely.</p>
            <Button type="button" size="sm" variant="outline" onClick={() => setShape({ mode: 'revolve', axis: 50 }, 'solid type')}>Use revolve</Button>
          </div>}
          {multi && <p className="trace-note">The solid is what the {[trace.views.front && 'front', trace.views.right?.regions.length && 'right', trace.views.top?.regions.length && 'top'].filter(Boolean).join(', ')} views share, each extruded straight through the part.</p>}
          {trace.shape.mode === 'revolve' && <>
            <label className="trace-range"><span>Axis position <output>{trace.shape.axis}% of front width</output></span>
              <input type="range" min="0" max="100" value={trace.shape.axis} onPointerDown={() => { live.current ??= trace }} {...slider('revolve axis')}
                onChange={(event) => { live.current ??= trace; onLive({ ...trace, shape: { ...trace.shape, axis: Number(event.target.value) } }) }} /></label>
            <p className="trace-note">Uses the front view. The profile right of the red axis is spun a full turn around it.</p>
          </>}
          {result.sizes && <p className="trace-note">{Object.entries(result.sizes).map(([item, value]) => viewLabels[item] + ' ' + value.width.toFixed(1) + ' × ' + value.height.toFixed(1)).join(' · ')} mm</p>}
          {result.warnings?.map((warning) => <p key={warning} className="trace-warning">{warning} Check each view's scale.</p>)}
        </div>

        {(result.error || error) && <p className="cad-error" role="alert">{error || result.error}</p>}
        <div className="cad-buttons">
          <Button type="button" disabled={Boolean(result.error) || building || upToDate} onClick={onBuild}>{building ? 'Building…' : upToDate ? 'Solid is up to date' : 'Build solid'}</Button>
          <Button type="button" variant="outline" title="Retrace this view and discard its edits" aria-label="Retrace this view and discard its edits" disabled={!view?.edited}
            onClick={() => setViewState((current) => retrace(current, current.settings), 'retrace')}><RotateCcw size={15} /></Button>
        </div>
        <Button type="button" className="w-full" variant="outline" disabled={!upToDate || building || exporting || Boolean(error)} onClick={onExport}><Download size={15} /> {exporting ? 'Preparing STEP…' : 'Export STEP solid'}</Button>
        <p className="mode-copy">Check critical sizes against the real part before fabrication.</p>
      </div>
    </section>
  )
}
