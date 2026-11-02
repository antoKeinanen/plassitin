import type { SeatingEvent } from './model'
import { isTagPreference, weightedClauses } from './model'
import type { ObjectiveName } from './solver-debug'
import { findPreferenceCliques } from './preference-cliques'

export interface OptimizationModel {
  constraints: string[]
  binaries: string[]
  bounds: string[]
  objectives: {name:ObjectiveName;expression:string}[]
  assignmentVariables: { personId: string; tableId: string; variable: string }[]
  cliqueSearch: ReturnType<typeof findPreferenceCliques>
}
type Term = { variable: string; coefficient: number }
const expression = (terms: Term[]) => terms.length ? terms.map(({variable,coefficient})=>`${coefficient<0?'-':'+'} ${Math.abs(coefficient)} ${variable}`).join(' ') : '0 zero'

function distributeBudget(weights: number[]): number[] {
  const total=weights.reduce((a,b)=>a+b,0)
  const values=weights.map(w=>Math.floor(w*1000/total))
  const order=weights.map((w,i)=>({i,remainder:w*1000%total})).sort((a,b)=>b.remainder-a.remainder||a.i-b.i)
  const remaining=1000-values.reduce((a,b)=>a+b,0)
  order.slice(0,remaining).forEach(({i})=>values[i]++)
  return values
}

export function buildOptimizationModel(event: SeatingEvent): OptimizationModel {
  const weighted=weightedClauses(event),clauses=weighted.map(item=>item.clause)
  const estimatedTerms=clauses.reduce((count,c)=>count+event.tables.length*(c.targets.length*3+6),0)+event.attendees.length*event.tables.length*5
  if(estimatedTerms>1500000)throw new Error('This event creates too many relationships. Reduce broad group requests or the number of tables.')
  const constraints: string[]=[], binaries:string[]=[], bounds=['zero = 0']
  const binary=()=>{const name=`v${binaries.length}`;binaries.push(name);return name}
  const add=(terms:Term[],relation:'='|'<='|'>=',rhs:number)=>constraints.push(`r${constraints.length}: ${expression(terms)} ${relation} ${rhs}`)
  const term=(variable:string,coefficient=1):Term=>({variable,coefficient})
  const assignmentVariables=event.attendees.flatMap(person=>event.tables.map(table=>({personId:person.id,tableId:table.id,variable:binary()})))
  const assignments=new Map(assignmentVariables.map(v=>[JSON.stringify([v.personId,v.tableId]),v.variable]))
  const x=(person:string,table:string)=>{const variable=assignments.get(JSON.stringify([person,table]));if(!variable)throw new Error('Unknown attendee or table.');return variable}
  for(const person of event.attendees)add(event.tables.map(t=>term(x(person.id,t.id))),'=',1)
  const usedTables:Term[]=[],fullTables:Term[]=[]
  for(const table of event.tables){
    const load=event.attendees.map(p=>term(x(p.id,table.id))),used=binary(),full=binary()
    add([...load,term(used,-table.capacity)],'<=' ,0)
    add([...load,term(used,-1)],'>=',0)
    add([...load,term(full,-table.capacity)],'>=',0)
    add([...load,term(full,-1)],'<=' ,table.capacity-1)
    usedTables.push(term(used,-1));fullTables.push(term(full))
  }
  for(const [person,table] of Object.entries(event.locks))add([term(x(person,table))],'=',1)
  for(const [a,b] of event.separations)for(const table of event.tables)add([term(x(a,table.id)),term(x(b,table.id))],'<=' ,1)
  // With interchangeable tables, first use follows table order and removes equivalent permutations.
  if(!Object.keys(event.locks).length&&event.tables.every(t=>t.capacity===event.tables[0].capacity)){
    if(event.attendees.length*event.tables.length>2000)add([term(x(event.attendees[0].id,event.tables[0].id))],'=',1)
    else event.attendees.forEach((p,i)=>event.tables.slice(1).forEach((t,j)=>{
      // Only the previous table's occupancy before this person matters.
      add([term(x(p.id,t.id)),...event.attendees.slice(0,i).map(previous=>term(x(previous.id,event.tables[j].id),-1))],'<=' ,0)
    }))
  }
  const hits=weighted.map(({clause,weight})=>{
    const hit=binary(),witnesses=event.tables.map(table=>{
      const witness=binary(),owner=x(clause.personId,table.id),targets=[...new Set(clause.targets)].map(p=>x(p,table.id))
      add([term(witness),term(owner,-1)],'<=' ,0)
      add([term(witness),...targets.map(t=>term(t,-1))],'<=' ,0)
      for(const target of targets)add([term(witness),term(owner,-1),term(target,-1)],'>=',-1)
      return witness
    })
    add([term(hit),...witnesses.map(w=>term(w,-1))],'=',0)
    return {clause,hit,weight}
  })
  const cliqueSearch=findPreferenceCliques(event),cliqueRewards:Term[]=[]
  for(const members of cliqueSearch.cliques)for(const table of event.tables){
    if(members.length>table.capacity)continue
    const together=binary(),seats=members.map(id=>x(id,table.id))
    for(const seat of seats)add([term(together),term(seat,-1)],'<=',0)
    add([term(together),...seats.map(seat=>term(seat,-1))],'>=',1-members.length)
    cliqueRewards.push(term(together,members.length))
  }
  const positive:Term[]=[],penalties:Term[]=[],covered:Term[]=[],fractions:Term[][]=[]
  for(const person of event.attendees){
    const likes=hits.filter(h=>h.clause.personId===person.id&&h.clause.kind==='prefer')
    const avoids=hits.filter(h=>h.clause.personId===person.id&&h.clause.kind==='avoid')
    if(likes.length){
      const weights=distributeBudget(likes.map(h=>h.weight)),score=likes.map((h,i)=>term(h.hit,weights[i]))
      positive.push(...score);fractions.push(score)
      const cover=binary();for(const h of likes)add([term(cover),term(h.hit,-1)],'>=',0)
      add([term(cover),...likes.map(h=>term(h.hit,-1))],'<=' ,0);covered.push(term(cover))
    }
    if(avoids.length){const weights=distributeBudget(avoids.map(h=>h.weight));penalties.push(...avoids.map((h,i)=>term(h.hit,-weights[i])))}
  }
  const objectives:OptimizationModel['objectives']=[{name:'Use fewer tables',expression:expression(usedTables)},{name:'Fill tables',expression:expression(fullTables)}]
  if(event.objective==='preferences'){
    objectives.push({name:'Weighted requests',expression:expression(hits.map(h=>term(h.hit,h.weight*(h.clause.kind==='prefer'?1:-1))))})
    if(cliqueRewards.length)objectives.push({name:'Keep mutual groups together',expression:expression(cliqueRewards)})
  }
  else{
    if(penalties.length)objectives.push({name:'Avoid unwanted pairings',expression:expression(penalties)})
    if(covered.length)objectives.push({name:'Give guests a companion',expression:expression(covered)})
    if(event.objective==='fairness'&&fractions.length){
      bounds.push('0 <= fairness_score <= 1000')
      for(const score of fractions)add([term('fairness_score'),...score.map(t=>({...t,coefficient:-t.coefficient}))],'<=' ,0)
      objectives.push({name:'Protect least satisfied guests',expression:'fairness_score'})
    }
    const named=hits.filter(h=>h.clause.kind==='prefer'&&!isTagPreference(h.clause))
    if(named.length)objectives.push({name:'Prioritize named companions',expression:expression(named.map(h=>term(h.hit,h.weight)))})
    if(cliqueRewards.length)objectives.push({name:'Keep mutual groups together',expression:expression(cliqueRewards)})
    if(positive.length)objectives.push({name:'Improve companion matches',expression:expression(positive)})
  }
  if(binaries.length>150000||constraints.length>500000)throw new Error('This event creates too many relationships. Reduce broad group requests or the number of tables.')
  return {constraints,binaries,bounds,objectives,assignmentVariables,cliqueSearch}
}
