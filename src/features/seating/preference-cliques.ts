import { isTagPreference, resolvedClauses } from './model'
import type { SeatingEvent } from './model'

export function findPreferenceCliques(event:SeatingEvent){
  const outgoing=new Map(event.attendees.map(person=>[person.id,new Set<string>()]))
  for(const clause of resolvedClauses(event))if(clause.kind==='prefer'&&!isTagPreference(clause)&&clause.targets.length===1)outgoing.get(clause.personId)?.add(clause.targets[0])
  const neighbors=new Map([...outgoing].map(([id,targets])=>[id,new Set([...targets].filter(target=>target!==id&&outgoing.get(target)?.has(id)))]))
  const adjacent=(a:string,b:string)=>neighbors.get(a)?.has(b)??false
  const cliques:string[][]=[]
  let visits=0,truncated=false
  const visit=(members:string[],candidates:string[],excluded:string[])=>{
    if(truncated)return
    if(++visits>20000||cliques.length>=256){truncated=true;return}
    if(!candidates.length&&!excluded.length){if(members.length>=3)cliques.push([...members].sort());return}
    if(members.length+candidates.length<3)return
    const pivot=[...candidates,...excluded].reduce<string|null>((best,id)=>best===null||candidates.filter(v=>adjacent(id,v)).length>candidates.filter(v=>adjacent(best,v)).length?id:best,null)
    let remaining=[...candidates]
    const seen=[...excluded]
    for(const id of candidates.filter(id=>pivot===null||!adjacent(pivot,id))){
      visit([...members,id],remaining.filter(v=>adjacent(id,v)),seen.filter(v=>adjacent(id,v)))
      remaining=remaining.filter(v=>v!==id);seen.push(id)
      if(truncated)return
    }
  }
  visit([],event.attendees.map(p=>p.id).sort(),[])
  cliques.sort((a,b)=>b.length-a.length||JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return{cliques,truncated}
}
