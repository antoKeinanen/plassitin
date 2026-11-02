import type { Attendee } from './model'
import { attendeeSchema } from './model'

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [], row: string[] = []
  let value = '', quoted = false
  for (let i=0;i<text.length;i++) {
    const ch = text[i]
    if (ch === '"') {
      if (quoted && text[i+1] === '"') { value += '"'; i++ }
      else if (!quoted && value.length || quoted && text[i+1] && ![',','\r','\n'].includes(text[i+1])) throw new Error('Invalid CSV quoting.')
      else quoted = !quoted
    } else if (ch === ',' && !quoted) { row.push(value); value = '' }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i+1] === '\n') i++
      row.push(value); if (row.some(v => v.trim())) rows.push([...row]); row.length=0; value=''
    } else value += ch
  }
  if (quoted) throw new Error('A CSV field has an unclosed quote.')
  row.push(value); if (row.some(v => v.trim())) rows.push(row)
  return rows
}
export function importAttendees(text: string): Attendee[] {
  const [header,...rows] = parseCsv(text.replace(/^\uFEFF/,''))
  if (!header) throw new Error('Add a header and at least one attendee.')
  const columns = header.map(h => h.trim().toLowerCase())
  const nameColumn = columns.indexOf('name')
  if (nameColumn < 0) throw new Error('The CSV needs a name column. Optional columns: groups, aliases, preferences.')
  const field = (row:string[], column:string) => row[columns.indexOf(column)]?.trim() || ''
  return rows.map(row => {
    const name = row[nameColumn]?.trim()
    if (!name) throw new Error('Every attendee needs a name.')
    return { id: crypto.randomUUID(), name, groups: field(row,'groups').split('|').filter(Boolean), aliases: field(row,'aliases').split('|').filter(Boolean), text: field(row,'preferences') }
  })
}
export function parsePastedAttendees(text: string): Attendee[] {
  const rows = parseCsv(text.replace(/^\uFEFF/,''))
  const first = rows[0]?.map(value=>value.trim().toLowerCase())
  if(first?.[0]==='name'&&['preferences','preference message'].includes(first[1]))rows.shift()
  if(!rows.length)throw new Error('Paste at least one attendee with a name and preference message column.')
  if(rows.length>300)throw new Error('Import up to 300 attendees at a time.')
  return rows.map((row,index)=>{
    if(row.length!==2)throw new Error(`Row ${index+1} needs exactly two columns. Put quotes around messages containing commas or line breaks.`)
    const name=row[0].trim(),text=row[1].trim()
    if(!name)throw new Error(`Row ${index+1} needs a name.`)
    if(name.length>150)throw new Error(`The name in row ${index+1} must be 150 characters or fewer.`)
    if(text.length>5000)throw new Error(`The message in row ${index+1} must be 5,000 characters or fewer.`)
    return attendeeSchema.parse({id:crypto.randomUUID(),name,text,groups:[],aliases:[]})
  })
}
