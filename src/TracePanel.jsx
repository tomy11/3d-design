import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, ImagePlus, RotateCcw, ScanLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { loadTraceImage, regionBounds, toMillimetres, traceImage } from './trace'
import { traceLimits, validateTrace } from './trace-spec'

const grab = 8

function hitVertex(regions, [x, y], radius) {
  let best = null
  regions.forEach((region, regionIndex) => [region.outer, ...region.holes].forEach((loop, loopIndex) => loop.forEach(([px, py], pointIndex) => {
    const distance = Math.hypot(px - x, py - y)
    if (distance <= radius && (!best || distance < best.distance)) best = { regionIndex, loopIndex, pointIndex, distance }
  })))
  return best
}

function hitSegment(regions, [x, y], radius) {
  let best = null
  regions.forEach((region, regionIndex) => [region.outer, ...region.holes].forEach((loop, loopIndex) => loop.forEach((a, pointIndex) => {
    const b = loop[(pointIndex + 1) % loop.length]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)))
    const distance = Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y)
    if (distance <= radius && (!best || distance < best.distance)) best = { regionIndex, loopIndex, pointIndex, distance }
  })))
  return best
}

function editLoop(regions, { regionIndex, loopIndex }, change) {
  return regions.map((region, r) => {
    if (r !== regionIndex) return region
    const loops = [region.outer, ...region.holes].map((loop, l) => l === loopIndex ? change(loop) : loop)
    return { outer: loops[0], holes: loops.slice(1) }
  })
}

export function TracePanel({ onBuild, onExport, building, exporting, error, built }) {
  const [image, setImage] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [settings, setSettings] = useState({ threshold: 128, invert: false, useAlpha: false, tolerance: 1.2, minArea: 40 })
  const [regions, setRegions] = useState([])
  const [edited, setEdited] = useState(false)
  const [shape, setShape] = useState({ width: 100, mode: 'extrude', thickness: 10, axis: 50 })
  const [lastBuilt, setLastBuilt] = useState(null)
  const canvas = useRef(null)
  const picture = useRef(null)
  const drag = useRef(null)
  const fileInput = useRef(null)

  // Retrace whenever the image or trace settings change. This replaces manual point edits.
  useEffect(() => {
    if (!image) return
    setRegions(traceImage(image, settings))
    setEdited(false)
  }, [image, settings])

  const spec = useMemo(() => {
    const converted = toMillimetres(regions, shape.width)
    if (!converted) return null
    return {
      mode: shape.mode,
      thickness: shape.thickness,
      axis: -shape.width / 2 + shape.width * shape.axis / 100,
      regions: converted.regions,
      height: converted.height,
    }
  }, [regions, shape])
  const invalid = image ? (spec ? validateTrace(spec) : 'No outline found. Adjust the threshold or try Invert.') : null
  const specKey = spec ? JSON.stringify(spec) : ''
  const changed = specKey !== lastBuilt
  const pointCount = regions.reduce((sum, region) => sum + region.outer.length + region.holes.reduce((n, hole) => n + hole.length, 0), 0)

  async function choose(file) {
    if (!file) return
    setLoadError('')
    try {
      const next = await loadTraceImage(file)
      setSettings((current) => ({ ...current, threshold: next.autoThreshold, useAlpha: next.hasAlpha, invert: false }))
      setImage(next)
      setLastBuilt(null)
    } catch (failure) {
      setLoadError(failure?.message ?? String(failure))
    }
  }

  useEffect(() => {
    if (!image) return
    const element = new Image()
    element.onload = () => { picture.current = element; redraw.current() }
    element.src = image.url
  }, [image])

  // Image pixels per CSS pixel of the preview canvas.
  function toImage(event) {
    const rect = canvas.current.getBoundingClientRect()
    const scale = image.width / rect.width
    return { point: [(event.clientX - rect.left) * scale, (event.clientY - rect.top) * scale], scale }
  }

  function draw() {
    const element = canvas.current
    if (!element || !image) return
    const ratio = window.devicePixelRatio || 1
    const width = element.clientWidth
    const height = width * image.height / image.width
    element.style.height = height + 'px'
    element.width = Math.round(width * ratio)
    element.height = Math.round(height * ratio)
    const context = element.getContext('2d')
    const scale = element.width / image.width
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, element.width, element.height)
    context.globalAlpha = 0.55
    if (picture.current) context.drawImage(picture.current, 0, 0, element.width, element.height)
    context.globalAlpha = 1
    context.setTransform(scale, 0, 0, scale, 0, 0)
    const pixel = 1 / scale
    if (shape.mode === 'revolve') {
      const bounds = regionBounds(regions)
      if (bounds) {
        const x = bounds.minX + (bounds.maxX - bounds.minX) * shape.axis / 100
        context.save()
        context.fillStyle = 'rgba(20, 28, 40, 0.28)'
        context.fillRect(0, 0, x, image.height)
        context.setLineDash([6 * pixel, 4 * pixel])
        context.strokeStyle = '#e0526a'
        context.lineWidth = 1.5 * pixel
        context.beginPath()
        context.moveTo(x, 0)
        context.lineTo(x, image.height)
        context.stroke()
        context.restore()
      }
    }
    regions.forEach((region) => {
      context.beginPath()
      for (const loop of [region.outer, ...region.holes]) {
        loop.forEach(([x, y], index) => context[index ? 'lineTo' : 'moveTo'](x, y))
        context.closePath()
      }
      context.fillStyle = 'rgba(77, 124, 255, 0.22)'
      context.fill('evenodd')
      ;[region.outer, ...region.holes].forEach((loop, index) => {
        context.beginPath()
        loop.forEach(([x, y], n) => context[n ? 'lineTo' : 'moveTo'](x, y))
        context.closePath()
        context.strokeStyle = index ? '#ef8a3c' : '#2f6bff'
        context.lineWidth = 1.6 * pixel
        context.stroke()
        context.fillStyle = index ? '#ef8a3c' : '#2f6bff'
        for (const [x, y] of loop) {
          context.beginPath()
          context.arc(x, y, 2.3 * pixel, 0, Math.PI * 2)
          context.fill()
        }
      })
    })
  }

  useEffect(draw)
  const redraw = useRef(draw)
  redraw.current = draw
  useEffect(() => {
    const observer = new ResizeObserver(() => redraw.current())
    if (canvas.current) observer.observe(canvas.current)
    return () => observer.disconnect()
  }, [image])

  function pointerDown(event) {
    if (event.button !== 0 || !regions.length) return
    const { point, scale } = toImage(event)
    const hit = hitVertex(regions, point, grab * scale)
    if (!hit) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = hit
  }

  function pointerMove(event) {
    const { point, scale } = toImage(event)
    if (!drag.current) {
      event.currentTarget.style.cursor = hitVertex(regions, point, grab * scale) ? 'grab' : hitSegment(regions, point, grab * scale) ? 'copy' : 'crosshair'
      return
    }
    const clamped = [Math.max(0, Math.min(image.width, point[0])), Math.max(0, Math.min(image.height, point[1]))]
    setRegions((current) => editLoop(current, drag.current, (loop) => loop.map((p, index) => index === drag.current.pointIndex ? clamped : p)))
    setEdited(true)
  }

  function doubleClick(event) {
    const { point, scale } = toImage(event)
    if (hitVertex(regions, point, grab * scale)) return
    const hit = hitSegment(regions, point, grab * scale)
    if (!hit) return
    setRegions((current) => editLoop(current, hit, (loop) => [...loop.slice(0, hit.pointIndex + 1), point, ...loop.slice(hit.pointIndex + 1)]))
    setEdited(true)
  }

  function contextMenu(event) {
    const { point, scale } = toImage(event)
    const hit = hitVertex(regions, point, grab * scale)
    if (!hit) return
    event.preventDefault()
    setRegions((current) => editLoop(current, hit, (loop) => loop.length > 3 ? loop.filter((_, index) => index !== hit.pointIndex) : loop))
    setEdited(true)
  }

  const set = (key) => (event) => setSettings({ ...settings, [key]: event.target.type === 'checkbox' ? event.target.checked : Number(event.target.value) })
  const setShapeValue = (key) => (event) => setShape({ ...shape, [key]: event.target.value === '' ? NaN : Number(event.target.value) })

  return (
    <section className="panel mode-panel">
      <div className="panel-heading mode-panel-title"><ScanLine size={16} /><h2>Trace from image</h2><span className="object-count">mm</span></div>
      <div className="mode-panel-body cad-form trace-form">
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={(event) => { choose(event.target.files?.[0]); event.target.value = '' }} />
        <Button type="button" variant="outline" className="w-full" onClick={() => fileInput.current.click()}><ImagePlus size={15} /> {image ? 'Replace image' : 'Import image'}</Button>
        {loadError && <p className="cad-error" role="alert">{loadError}</p>}
        {!image && <p className="mode-copy">Use a straight-on photo, drawing or silhouette with the part on a plain background. Each image is traced as one view of the part.</p>}
        {image && <>
          <div className="trace-preview">
            <canvas ref={canvas} aria-label={'Traced outline of ' + image.name} onPointerDown={pointerDown} onPointerMove={pointerMove}
              onPointerUp={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}
              onDoubleClick={doubleClick} onContextMenu={contextMenu} />
          </div>
          <p className="trace-hint">Drag a point to move it · double-click a line to add one · right-click a point to remove it.
            <span>{regions.length} {regions.length === 1 ? 'region' : 'regions'} · {pointCount} points{edited ? ' · edited' : ''}</span></p>

          <div className="trace-group">
            <h4>Outline</h4>
            {image.hasAlpha && <label className="trace-check"><input type="checkbox" checked={settings.useAlpha} onChange={set('useAlpha')} /> Use transparency as the outline</label>}
            {!settings.useAlpha && <label className="trace-range"><span>Threshold <output>{settings.threshold}</output></span>
              <input type="range" min="1" max="254" value={settings.threshold} onChange={set('threshold')} /></label>}
            <label className="trace-check"><input type="checkbox" checked={settings.invert} onChange={set('invert')} /> Invert (part is lighter than background)</label>
            <label className="trace-range"><span>Detail <output>{settings.tolerance <= 0.8 ? 'Fine' : settings.tolerance >= 3 ? 'Coarse' : 'Medium'}</output></span>
              <input type="range" min="0.4" max="6" step="0.1" value={6.4 - settings.tolerance} onChange={(event) => setSettings({ ...settings, tolerance: Math.round((6.4 - Number(event.target.value)) * 10) / 10 })} /></label>
            <label className="trace-range"><span>Ignore specks under <output>{settings.minArea} px²</output></span>
              <input type="range" min="0" max="2000" step="10" value={settings.minArea} onChange={set('minArea')} /></label>
            {edited && <p className="trace-note">Changing these settings retraces the image and discards point edits.</p>}
          </div>

          <div className="trace-group">
            <h4>Solid</h4>
            <div className="section-axes trace-mode" aria-label="Solid type">
              {[['extrude', 'Extrude'], ['revolve', 'Revolve']].map(([id, label]) =>
                <Button key={id} type="button" size="sm" variant="outline" aria-pressed={shape.mode === id} onClick={() => setShape({ ...shape, mode: id })}>{label}</Button>)}
            </div>
            <div className="cad-dimensions">
              <label><span>Real width (mm)</span><input type="number" inputMode="decimal" min={traceLimits.width[0]} max={traceLimits.width[1]} step="any" value={Number.isNaN(shape.width) ? '' : shape.width} onChange={setShapeValue('width')} /></label>
              {shape.mode === 'extrude'
                ? <label><span>Thickness (mm)</span><input type="number" inputMode="decimal" min={traceLimits.thickness[0]} max={traceLimits.thickness[1]} step="any" value={Number.isNaN(shape.thickness) ? '' : shape.thickness} onChange={setShapeValue('thickness')} /></label>
                : <label><span>Height (mm)</span><input value={spec ? spec.height.toFixed(1) : '—'} readOnly tabIndex={-1} /></label>}
            </div>
            {shape.mode === 'extrude' && spec && <p className="trace-note">Height follows the image: {spec.height.toFixed(1)} mm.</p>}
            {shape.mode === 'revolve' && <label className="trace-range"><span>Axis position <output>{shape.axis}% of width</output></span>
              <input type="range" min="0" max="100" value={shape.axis} onChange={(event) => setShape({ ...shape, axis: Number(event.target.value) })} /></label>}
            {shape.mode === 'revolve' && <p className="trace-note">The profile right of the red axis is spun a full turn around it. Shaded area is ignored.</p>}
          </div>

          {(invalid || error) && <p className="cad-error" role="alert">{invalid || error}</p>}
          <div className="cad-buttons">
            <Button type="button" disabled={Boolean(invalid) || building || !changed} onClick={() => { setLastBuilt(specKey); onBuild(spec) }}>{building ? 'Building…' : built && !changed ? 'Solid is up to date' : 'Build solid'}</Button>
            <Button type="button" variant="outline" title="Retrace and discard point edits" aria-label="Retrace and discard point edits" disabled={!edited}
              onClick={() => { setRegions(traceImage(image, settings)); setEdited(false) }}><RotateCcw size={15} /></Button>
          </div>
          <Button type="button" className="w-full" variant="outline" disabled={!built || changed || building || exporting || Boolean(error)} onClick={onExport}><Download size={15} /> {exporting ? 'Preparing STEP…' : 'Export STEP solid'}</Button>
          <p className="mode-copy">Traced dimensions come from the real width you enter. Check critical sizes against the part before fabrication.</p>
        </>}
      </div>
    </section>
  )
}
