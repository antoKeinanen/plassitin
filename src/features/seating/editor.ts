import { z } from 'zod'
import { eventSchema, isTagPreference, normalize } from './model'
import type { Attendee, Clause, SeatingEvent } from './model'
import { resolveReferences } from './preferences'
import { createNameMatcher } from './name-matching'

export const decisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ignore') }),
  z.object({ kind: z.literal('person'), personId: z.string() }),
  z.object({ kind: z.literal('code'), code: z.string() }),
  z.object({ kind: z.literal('reference'), reference: z.string().trim().min(1).max(5000) }),
])
export const editorSchema = z.object({
  version: z.literal(2), event: eventSchema,
  links: z.record(z.string(), z.array(z.string()).max(100)),
  decisions: z.record(z.string(), decisionSchema),
  manualReferences: z.record(z.string(), z.array(z.string().trim().min(1).max(5000)).max(50)).optional(),
  assignments: z.record(z.string(), z.string()),
  seatIndices: z.record(z.string(), z.number().int().min(0).max(99)).optional(),
}).transform(({manualReferences,...document},ctx)=>{
  const tags=new Map<string,string[]>()
  const add=(personId:string,value:string)=>tags.set(personId,[...(tags.get(personId)||[]),value])
  const addPerson=(owner:string,target:string)=>{document.links={...document.links,[owner]:[...new Set([...(document.links[owner]||[]),target])]}}
  for(const [owner,references] of Object.entries(manualReferences||{}))for(const reference of references){
    const decision=document.decisions[JSON.stringify([owner,'prefer',normalize(reference),'manual'])]
    if(decision?.kind==='ignore')continue
    if(decision?.kind==='person'){addPerson(owner,decision.personId);continue}
    const value=decision?.kind==='code'?decision.code:decision?.kind==='reference'?decision.reference:reference
    add(owner,legacyTag(value)||value)
  }
  const clauses=document.event.clauses.filter(clause=>{
    if(isChipClause(clause)||isInferredNameClause(clause))return true
    const decision=document.decisions[referenceKey(clause)]
    if(decision?.kind==='person'&&(legacyTag(clause.reference)||clause.id.startsWith('manual-ref:'))&&clause.kind==='prefer'){
      if(clause.state!=='ignored')addPerson(clause.personId,decision.personId)
      return false
    }
    const tag=decision?.kind==='code'?decision.code:decision?.kind==='reference'?legacyTag(decision.reference):legacyTag(clause.reference)
    if(!tag&&!clause.id.startsWith('manual-ref:'))return true
    if(tag&&clause.kind==='prefer'&&clause.state!=='ignored'&&decision?.kind!=='ignore')add(clause.personId,tag)
    return false
  })
  if(!tags.size&&clauses.length===document.event.clauses.length)return document
  const attendees=document.event.attendees.map(person=>({...person,groups:[...new Map([...person.groups,...(tags.get(person.id)||[])].map(tag=>[normalize(tag),tag])).values()]}))
  const event=eventSchema.safeParse({...document.event,attendees,clauses})
  if(!event.success){ctx.addIssue({code:'custom',message:'The saved tags exceed the event limits.'});return z.NEVER}
  return {...document,event:event.data}
})
export type EditorDocument = z.infer<typeof editorSchema>
export function createEmptyDocument():EditorDocument{
  return{version:2,event:{version:1,name:'Seating plan',attendees:[],tables:[1,2,3].map(i=>({id:`t${i}`,name:`Table ${i}`,capacity:16})),clauses:[],locks:{},separations:[],objective:'balanced'},links:{},decisions:{},assignments:{}}
}
export type Decision = z.infer<typeof decisionSchema>
export const referenceKey = (clause: Clause) => JSON.stringify([clause.personId, clause.kind, normalize(clause.reference), ...(clause.id.startsWith('manual-ref:') ? ['manual'] : [])])
export const isChipClause = (clause: Clause) => clause.id.startsWith('chip:')
export const isInferredNameClause = (clause:Clause)=>clause.id.startsWith('name-inference:')
function legacyTag(reference:string){return /^(?:(?:anyone|someone|people|the people|anybody)\s+)?(?:from|in|on)\s+(.+)$/i.exec(reference.trim())?.[1].replace(/^#/,'').trim()}

export function applyDecision(clause: Clause, attendees: Attendee[], decision: Decision | undefined): Clause {
  if (!decision) return clause
  const base = { id: clause.id, personId: clause.personId, reference: clause.reference, kind: clause.kind, weight: clause.weight }
  if (decision.kind === 'ignore') return { ...base, state: 'ignored' }
  if (decision.kind === 'reference') {
    const [replacement] = resolveReferences([{ reference: decision.reference, kind: clause.kind, weight: clause.weight }], clause.personId, attendees)
    return { ...replacement, id: clause.id, reference: clause.reference }
  }
  const targets = attendees.filter(p => p.id !== clause.personId && (decision.kind === 'person' ? p.id === decision.personId : p.groups.some(g => normalize(g) === normalize(decision.code)))).map(p => p.id)
  return targets.length ? { ...base, state: 'resolved', targets } : { ...base, state: 'unresolved' }
}

export function rebuildEvent(document: Pick<EditorDocument, 'event' | 'links' | 'decisions'>): SeatingEvent {
  const { event, links, decisions } = document
  const mappedClauses: Clause[] = event.clauses.filter(c => !isChipClause(c)).map(c => {
    if(isInferredNameClause(c)){
      const valid=c.state!=='resolved'||c.targets.every(id=>id!==c.personId&&event.attendees.some(person=>person.id===id))
      const clause:Clause=valid?c:{id:c.id,personId:c.personId,reference:c.reference,kind:c.kind,weight:c.weight,state:'unresolved'}
      return applyDecision(clause,event.attendees,decisions[referenceKey(c)])
    }
    const [resolved] = resolveReferences([{ reference: c.reference, kind: c.kind, weight: c.weight }], c.personId, event.attendees)
    return applyDecision({ ...resolved, id: c.id }, event.attendees, decisions[referenceKey(c)])
  })
  const clauses:Clause[]=[]
  for (const person of event.attendees) {
    for (const target of links[person.id] || []) if (target !== person.id && event.attendees.some(p => p.id === target)) clauses.push({ id: `chip:${person.id}:${target}`, personId: person.id, reference: event.attendees.find(p => p.id === target)?.name || target, state: 'resolved', targets: [target],source:'name', kind: 'prefer', weight: 1 })
    for (const [index, code] of person.groups.entries()) {
      const targets = event.attendees.filter(p => p.id !== person.id && p.groups.some(g => normalize(g) === normalize(code))).map(p => p.id)
      if(targets.length)clauses.push({ id: `chip:${person.id}:code:${index}`, personId: person.id, reference: code, state: 'resolved', targets,match:'each',source:'tag', kind: 'prefer', weight: 1 })
    }
  }
  return { ...event, clauses:[...clauses,...mappedClauses] }
}

export function inferMessageNames(document:EditorDocument):EditorDocument{
  const match=createNameMatcher(document.event.attendees),clauses=[...document.event.clauses]
  const references=new Set(clauses.filter(c=>!isChipClause(c)).map(referenceKey))
  const linked=new Set(clauses.flatMap(c=>c.state==='resolved'&&!isTagPreference(c)?c.targets.map(id=>JSON.stringify([c.personId,c.kind,id])):[]))
  for(const [owner,targets] of Object.entries(document.links))for(const target of targets)linked.add(JSON.stringify([owner,'prefer',target]))
  for(const person of document.event.attendees)for(const mention of match(person.text,person.id)){
    const base={id:`name-inference:${crypto.randomUUID()}`,personId:person.id,kind:mention.preference,weight:1,reference:mention.reference}
    const key=referenceKey({...base,state:'unresolved'})
    if(references.has(key))continue
    const target=mention.state==='resolved'?JSON.stringify([person.id,mention.preference,mention.personId]):null
    if(target&&linked.has(target))continue
    const clause:Clause=mention.state==='resolved'?{...base,state:'resolved',source:'name',targets:[mention.personId]}:{...base,state:'unresolved'}
    clauses.push(clause);references.add(key);if(target)linked.add(target)
  }
  if(clauses.length>3000)throw new Error('Too many name matches. Infer names with fewer attendees or shorter messages.')
  const next={...document,event:{...document.event,clauses}}
  return editorSchema.parse({...next,event:rebuildEvent(next)})
}

export function updatePerson(document: EditorDocument, person: Attendee): EditorDocument {
  const event = rebuildEvent({ ...document, event: { ...document.event, attendees: document.event.attendees.map(p => p.id === person.id ? person : p) } })
  return { ...document, event }
}

export function fillAssignments(event: SeatingEvent, previous: Record<string, string> = {}): Record<string, string> {
  const assignments: Record<string, string> = {}, counts = new Map(event.tables.map(t => [t.id, 0]))
  const place = (person: string, table: string) => {
    const target = event.tables.find(t => t.id === table)
    if (!target || (counts.get(table) || 0) >= target.capacity) return false
    if (event.separations.some(([a,b]) => a === person && assignments[b] === table || b === person && assignments[a] === table)) return false
    assignments[person] = table; counts.set(table, (counts.get(table) || 0) + 1); return true
  }
  for (const person of event.attendees) if (event.locks[person.id]) place(person.id, event.locks[person.id])
  for (const person of event.attendees) if (!assignments[person.id] && !event.locks[person.id] && previous[person.id]) place(person.id, previous[person.id])
  for (const person of event.attendees) if (!assignments[person.id] && !event.locks[person.id]) {
    for (const table of event.tables) if (place(person.id, table.id)) break
  }
  return assignments
}

export function resizeTables(document: EditorDocument, count: number): EditorDocument {
  const tables = [...document.event.tables]
  while (tables.length < count) tables.push({ id: crypto.randomUUID(), name: `Table ${tables.length + 1}`, capacity: tables.at(-1)?.capacity || 16 })
  tables.length = count
  const ids = new Set(tables.map(t => t.id)), locks = Object.fromEntries(Object.entries(document.event.locks).filter(([,table]) => ids.has(table)))
  const event = { ...document.event, tables, locks }
  return { ...document, event, assignments: fillAssignments(event, document.assignments) }
}

export function rotateTable(document:EditorDocument,tableId:string):EditorDocument{
  return{...document,event:{...document.event,tables:document.event.tables.map((table):SeatingEvent['tables'][number]=>{
    if(table.id!==tableId)return table
    if(table.rotation===90){const {rotation,...vertical}=table;return vertical}
    return{...table,rotation:90}
  })}}
}

export interface Camera { x: number; y: number; scale: number }
export const clampScale = (scale: number) => Math.max(.01, Math.min(2.5, scale))
export function zoomCamera(camera: Camera, factor: number, point: { x: number; y: number }): Camera {
  const scale = clampScale(camera.scale * factor), ratio = scale / camera.scale
  return { scale, x: point.x - (point.x - camera.x) * ratio, y: point.y - (point.y - camera.y) * ratio }
}
export function tableLayout(tables: SeatingEvent['tables']) {
  const size=72,gap=10,padding=12,width=2*size+gap+2*padding
  let left=48,top=56,runWidth=0
  return tables.map((table,index)=>{
    const length=Math.ceil(table.capacity/2)*(size+gap)-gap+2*padding,horizontal=table.rotation===90
    const x=left,y=horizontal?top:56,tableWidth=horizontal?length:width
    if(horizontal){top+=width+72;runWidth=Math.max(runWidth,tableWidth);if(tables[index+1]?.rotation!==90){left+=runWidth+72;top=56;runWidth=0}}
    else left+=tableWidth+72
    return{...table,x,y,width:tableWidth,height:horizontal?width:length,seats:Array.from({length:table.capacity},(_,seat)=>{
      const x=padding+(seat%2)*(size+gap),y=padding+Math.floor(seat/2)*(size+gap)
      return horizontal?{x:length-y-size,y:x,size}:{x,y,size}
    })}
  })
}
export function fitCamera(viewport: { width: number; height: number }, scene: { width: number; height: number }): Camera {
  const scale = Math.min(1, clampScale(Math.min((viewport.width - 70) / scene.width, (viewport.height - 90) / scene.height)))
  return { scale, x: (viewport.width - scene.width * scale) / 2, y: (viewport.height - scene.height * scale) / 2 }
}
