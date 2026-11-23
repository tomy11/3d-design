import { useEffect, useState } from 'react'
import { Box, Download, Ruler, RotateCcw, Scissors } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { adapterDefaults, adapterFields, validateAdapter } from './adapter-spec'

export function CadPanel({ dimensions, onApply, onExport, building, exporting, error }) {
  const [draft, setDraft] = useState(dimensions)
  useEffect(() => setDraft(dimensions), [dimensions])
  const values = Object.fromEntries(adapterFields.map(({ id }) => [id, draft[id] === '' ? NaN : Number(draft[id])]))
  const invalid = validateAdapter(values)
  const changed = adapterFields.some(({ id }) => values[id] !== dimensions[id])
  return (
    <section className="panel mode-panel">
      <div className="panel-heading mode-panel-title"><Box size={16} /><h2>Flange adapter</h2><span className="object-count">mm</span></div>
      <form className="mode-panel-body cad-form" onSubmit={(event) => { event.preventDefault(); if (!invalid && changed) onApply(values) }} noValidate>
        <div className="cad-dimensions">
          {adapterFields.map(({ id, label, min, max, integer }) => <label key={id}>
            <span>{label}</span>
            <input type="number" inputMode={integer ? 'numeric' : 'decimal'} value={draft[id]} min={min} max={max}
              step={integer ? 1 : 'any'} onChange={(event) => setDraft({ ...draft, [id]: event.target.value })} />
          </label>)}
        </div>
        {(invalid || error) && <p className="cad-error" role="alert">{invalid || error}</p>}
        <div className="cad-buttons">
          <Button type="submit" disabled={Boolean(invalid) || !changed || building}>{building ? 'Building…' : 'Rebuild solid'}</Button>
          <Button type="button" variant="outline" title="Restore example dimensions" aria-label="Restore example dimensions" onClick={() => setDraft(adapterDefaults)}><RotateCcw size={15} /></Button>
        </div>
        <Button type="button" className="w-full" variant="outline" disabled={changed || building || exporting || Boolean(error)} onClick={onExport}><Download size={15} /> {exporting ? 'Preparing STEP…' : 'Export STEP solid'}</Button>
        <p className="mode-copy">Example part with editable dimensions. Confirm the bolt pattern against your hardware before fabrication.</p>
      </form>
    </section>
  )
}

export function ViewPanel({ measure, result, clearMeasurement, section, setSection }) {
  return (
    <section className="panel mode-panel">
      <div className="panel-heading mode-panel-title">{measure ? <Ruler size={16} /> : <Scissors size={16} />}<h2>{measure && section.enabled ? 'Measure and section' : measure ? 'Measure distance' : 'Section plane'}</h2></div>
      <div className="mode-panel-body workbench-tools">
        {measure && <div className="measurement-result">
          <div><small>Point-to-point distance</small>
            <output aria-live="polite">{result.count === 2 ? result.distance.toFixed(2) + ' mm' : 'Select point ' + (result.count + 1)}</output>
          </div>
          <Button variant="ghost" size="sm" onClick={clearMeasurement} disabled={!result.count}>Clear</Button>
        </div>}
        {section.enabled && <div className="section-controls">
          <div className="section-axes" aria-label="Section axis">
            {['x', 'y', 'z'].map((axis) => <Button key={axis} size="sm" variant="outline" aria-pressed={section.axis === axis}
              onClick={() => setSection({ ...section, axis })}>{axis.toUpperCase()}</Button>)}
          </div>
          <label>Offset (mm)<input type="number" min="-1500" max="1500" step="1" value={section.offset}
            onChange={(event) => setSection({ ...section, offset: Math.max(-1500, Math.min(1500, Number(event.target.value))) })} /></label>
          <input type="range" min="-1500" max="1500" step="1" aria-label="Section plane offset" value={section.offset}
            onChange={(event) => setSection({ ...section, offset: Number(event.target.value) })} />
        </div>}
      </div>
    </section>
  )
}
