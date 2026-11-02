import { isTagPreference, normalize, resolvedClauses } from './model'
import type { SeatingEvent } from './model'
import { findPreferenceCliques } from './preference-cliques'

export function seatPreferenceBlocks(event:SeatingEvent){
  const groups=new Map<string,{members:string[];weight:number}>()
  const add=(ids:string[],weight:number)=>{
    const members=[...new Set(ids)].sort();if(members.length<3)return
    const key=JSON.stringify(members),existing=groups.get(key)
    if(!existing||weight>existing.weight)groups.set(key,{members,weight})
  }
  const tags=new Map<string,string[]>()
  for(const person of event.attendees)for(const tag of person.groups){const key=normalize(tag);tags.set(key,[...(tags.get(key)||[]),person.id])}
  for(const members of tags.values())add(members,1000)
  for(const members of findPreferenceCliques(event).cliques)add(members,5000)
  const requesters=new Map<string,string[]>()
  for(const clause of resolvedClauses(event))if(clause.kind==='prefer'&&!isTagPreference(clause)&&clause.targets.length===1){
    const target=clause.targets[0];requesters.set(target,[...(requesters.get(target)||[]),clause.personId])
  }
  for(const [target,members] of requesters)add([target,...members],5000)
  return [...groups.values()]
}

export function seatBlockCost(group:{members:number[];weight:number},position:(person:number)=>number){
  const rows=group.members.map(person=>Math.floor(position(person)/2))
  const excessRows=Math.max(...rows)-Math.min(...rows)+1-Math.ceil(group.members.length/2)
  return Math.max(0,excessRows)*Math.max(1,Math.round(group.weight/group.members.length))
}

export function scoreSeatBlocks(event:SeatingEvent,assignments:Record<string,string>,indices:Record<string,number>){
  let cost=0
  for(const group of seatPreferenceBlocks(event))for(const table of event.tables){
    const ids=group.members.filter(id=>assignments[id]===table.id);if(ids.length<3)continue
    cost+=seatBlockCost({members:ids.map((_,index)=>index),weight:group.weight},person=>indices[ids[person]])
  }
  return cost
}
