export const adapterDefaults = { diameter: 110, thickness: 12, bore: 32, pitch: 80, hole: 6.6, count: 4 }
export const adapterFields = [
  { id: 'diameter', label: 'Outside diameter', min: 20, max: 400 },
  { id: 'thickness', label: 'Thickness', min: 2, max: 100 },
  { id: 'bore', label: 'Center bore', min: 2, max: 350 },
  { id: 'pitch', label: 'Bolt circle diameter', min: 8, max: 390 },
  { id: 'hole', label: 'Bolt hole diameter', min: 1, max: 60 },
  { id: 'count', label: 'Bolt holes', min: 2, max: 12, integer: true },
]

export function validateAdapter(values) {
  for (const { id, label, min, max, integer } of adapterFields) {
    const value = values?.[id]
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      return label + ' must be ' + (integer ? 'a whole number ' : '') + 'between ' + min + ' and ' + max + '.'
    }
  }
  const { diameter, bore, pitch, hole, count } = values
  if ((diameter - pitch - hole) / 2 < 1) return 'Leave at least 1 mm between bolt holes and the outer edge.'
  if ((pitch - hole - bore) / 2 < 1) return 'Leave at least 1 mm between the center bore and each bolt hole.'
  if (pitch * Math.sin(Math.PI / count) - hole < 1) return 'Leave at least 1 mm between adjacent bolt holes.'
  return null
}
