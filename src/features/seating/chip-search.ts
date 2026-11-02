import { normalize } from './model'
import type { Attendee } from './model'

export interface ChipOption {
  kind: 'person' | 'code'
  value: string
  label: string
}

export function searchChips({ query, person, attendees, excludedPersonIds }: {
  query: string; person: Attendee; attendees: Attendee[]; excludedPersonIds: string[]
}) {
  const text=query.trim(),tagSearch=text.replace(/^#+/,'')
  const codes=[...new Map(attendees.flatMap(p=>p.groups).map(code=>[normalize(code),code])).values()]
  const groups:ChipOption[]=codes.filter(code=>normalize(code).includes(normalize(tagSearch))&&!person.groups.some(own=>normalize(own)===normalize(code)))
    .sort((a,b)=>Number(normalize(b)===normalize(tagSearch))-Number(normalize(a)===normalize(tagSearch)))
    .map(code=>({kind:'code',value:code,label:`#${code}`}))
  const people:ChipOption[]=text.startsWith('#')?[]:attendees.filter(p=>p.id!==person.id&&!excludedPersonIds.includes(p.id)&&[p.name,...p.aliases].some(name=>normalize(name).includes(normalize(text))))
    .map(p=>({kind:'person',value:p.id,label:p.name}))
  return {options:[...people.slice(0,3),...groups,...people.slice(3)].slice(0,10)}
}
