// Minimal RFC4180-ish CSV parser — handles quoted fields with embedded
// commas/newlines and doubled "" escapes, which is what WooCommerce exports.
export function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  const filtered = rows.filter(r => r.some(c => c.trim() !== ''))
  const [headerRow, ...dataRows] = filtered
  const headers = (headerRow ?? []).map(h => h.trim())

  const records = dataRows.map(r => {
    const obj: Record<string, string> = {}
    headers.forEach((h, idx) => { obj[h] = (r[idx] ?? '').trim() })
    return obj
  })

  return { headers, rows: records }
}
