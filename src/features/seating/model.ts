import { z } from 'zod'

const id = z.string().min(1).max(100)
export const attendeeSchema = z.object({ id, name: z.string().trim().min(1).max(150), aliases: z.array(z.string().max(150)).max(20), groups: z.array(z.string().max(100)).max(20), text: z.string().max(5000) })
const clauseBase = { id, personId: id, kind: z.enum(['prefer', 'avoid']), reference: z.string().min(1).max(5000), weight: z.number().int().min(1).max(5) }
export const clauseSchema = z.discriminatedUnion('state', [
  z.object({ ...clauseBase, state: z.literal('resolved'), targets: z.array(id).min(1).max(300), match: z.enum(['any','each']).optional(), source:z.enum(['name','tag']).optional() }),
  z.object({ ...clauseBase, state: z.literal('unresolved') }),
  z.object({ ...clauseBase, state: z.literal('ignored') }),
])
export const eventSchema = z.object({
  version: z.literal(1), name: z.string().trim().min(1).max(150),
  attendees: z.array(attendeeSchema).max(300),
  tables: z.array(z.object({ id, name: z.string().trim().min(1).max(100), capacity: z.number().int().min(1).max(100), rotation:z.union([z.literal(0),z.literal(90)]).optional() })).min(1).max(60),
  clauses: z.array(clauseSchema).max(3000),
  locks: z.record(id, id), separations: z.array(z.tuple([id, id])).max(1000),
  objective: z.enum(['balanced', 'preferences', 'fairness']),
}).superRefine((event, ctx) => {
  const people = new Set(event.attendees.map(p => p.id)), tables = new Set(event.tables.map(t => t.id))
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
  if (people.size !== event.attendees.length || tables.size !== event.tables.length || new Set(event.clauses.map(c => c.id)).size !== event.clauses.length) issue('IDs must be unique.')
  for (const clause of event.clauses) {
    if (!people.has(clause.personId)) issue('A request belongs to an unknown attendee.')
    if (clause.state === 'resolved' && clause.targets.some(target => !people.has(target) || target === clause.personId)) issue('Request targets must be other registered attendees.')
  }
  for (const [person, table] of Object.entries(event.locks)) if (!people.has(person) || !tables.has(table)) issue('A lock refers to an unknown person or table.')
  for (const [a,b] of event.separations) if (!people.has(a) || !people.has(b) || a === b) issue('Separation requires two different attendees.')
})
export const resultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('plan'), status: z.enum(['optimal', 'feasible']), assignments: z.record(id,id),seatIndices:z.record(id,z.number().int().min(0).max(99)).optional(), seconds: z.number().nonnegative() }),
  z.object({ kind: z.enum(['infeasible', 'timeout']), message: z.string() }),
])
export type Attendee = z.infer<typeof attendeeSchema>
export type Clause = z.infer<typeof clauseSchema>
export type SeatingEvent = z.infer<typeof eventSchema>
export type SolveResult = z.infer<typeof resultSchema>
export type Plan = Extract<SolveResult, { kind: 'plan' }>
export function isTagPreference(clause:Extract<Clause,{state:'resolved'}>){return clause.source==='tag'||!clause.source&&clause.match==='each'&&clause.id.startsWith(`chip:${clause.personId}:code:`)}
function preferenceWeight(clause:Extract<Clause,{state:'resolved'}>,choices=1){return Math.max(1,Math.round(clause.weight*1000*(isTagPreference(clause)?1:5)/choices))}
export const resolvedClauses = (event: SeatingEvent) => {
  const unique=new Map<string,Extract<Clause,{state:'resolved'}>>()
  const resolved=event.clauses.filter((c):c is Extract<Clause,{state:'resolved'}>=>c.state==='resolved')
  const requests=resolved.flatMap(clause=>clause.match==='each'?clause.targets.map((target,index)=>({...clause,id:`${clause.id}:${index}`,targets:[target]})):clause)
  for(const c of requests){
    const key = JSON.stringify([c.personId, c.kind, [...new Set(c.targets)].sort()])
    const previous=unique.get(key)
    if(!previous||preferenceWeight(c)>preferenceWeight(previous)||preferenceWeight(c)===preferenceWeight(previous)&&!isTagPreference(c)&&isTagPreference(previous))unique.set(key,c)
  }
  return [...unique.values()]
}
export function weightedClauses(event:SeatingEvent){
  const clauses=resolvedClauses(event),namedChoices=new Map<string,Set<string>>(),tagChoices=new Map<string,Set<string>>()
  for(const clause of clauses)if(clause.kind==='prefer'){
    const choices=isTagPreference(clause)?tagChoices:namedChoices,targets=choices.get(clause.personId)||new Set<string>()
    for(const target of clause.targets)targets.add(target)
    choices.set(clause.personId,targets)
  }
  return clauses.map(clause=>{
    if(clause.kind!=='prefer')return{clause,weight:preferenceWeight(clause)}
    const choices=(isTagPreference(clause)?tagChoices:namedChoices).get(clause.personId),count=choices?.size||1
    const rank=!isTagPreference(clause)&&clause.targets.length===1?[...(choices??[])].indexOf(clause.targets[0]):-1
    const divisor=rank>=0?count*(count+1)/(2*(count-rank)):count
    return{clause,weight:preferenceWeight(clause,divisor)}
  })
}
export function evaluatePlan(event: SeatingEvent, assignments: Record<string, string>,seatIndices?:Record<string,number>) {
  const violations: string[] = []
  const tableIds = new Set(event.tables.map(t => t.id))
  for (const person of event.attendees) {
    if (!tableIds.has(assignments[person.id])) violations.push(`${person.name} needs a valid table.`)
    if (event.locks[person.id] && event.locks[person.id] !== assignments[person.id]) violations.push(`${person.name}'s lock is violated.`)
  }
  if (Object.keys(assignments).length !== event.attendees.length) violations.push('The assignment roster does not match the event.')
  for (const table of event.tables) if (Object.values(assignments).filter(t => t === table.id).length > table.capacity) violations.push(`${table.name} exceeds capacity.`)
  for (const [a,b] of event.separations) if (assignments[a] === assignments[b]) violations.push('A mandatory separation is violated.')
  if(seatIndices){
    const occupied=new Set<string>()
    for(const person of event.attendees){
      const seat=seatIndices[person.id],table=event.tables.find(t=>t.id===assignments[person.id]),key=JSON.stringify([assignments[person.id],seat])
      if(!table||!Number.isInteger(seat)||seat<0||seat>=table.capacity)violations.push(`${person.name} needs a valid seat.`)
      else if(occupied.has(key))violations.push('Two guests occupy the same seat.')
      occupied.add(key)
    }
    if(Object.keys(seatIndices).length!==event.attendees.length)violations.push('The seat roster does not match the event.')
  }
  const clauses = resolvedClauses(event).map(c => ({ ...c, met: c.kind === 'prefer' ? c.targets.some(t => assignments[t] === assignments[c.personId]) : c.targets.every(t => assignments[t] !== assignments[c.personId]) }))
  const positive = clauses.filter(c => c.kind === 'prefer'), avoidance = clauses.filter(c => c.kind === 'avoid')
  const eligible = new Set(positive.map(c => c.personId)), covered = new Set(positive.filter(c => c.met).map(c => c.personId))
  return { violations, clauses, positive: { met: positive.filter(c => c.met).length, total: positive.length }, avoidance: { met: avoidance.filter(c => c.met).length, total: avoidance.length }, coverage: { met: covered.size, total: eligible.size } }
}
export const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()
