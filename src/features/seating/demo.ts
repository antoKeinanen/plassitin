import type { SeatingEvent } from './model'
import { parseReferenceList, resolveReferences } from './preferences'

export function createDemo(): SeatingEvent {
  const rows: [string,string,string,string][] = [
    ['Anna Virtanen','Marketing|Helsinki','Annie','Julia, anyone from Marketing'],
    ['Peter Laine','Engineering|Helsinki','Pete','Oskari, Lucas'],
    ['Sarah Jones','Sales|London','','Mike, Emma'],
    ['Michael Smith','Sales|London','Mike','Sarah, anyone from London'],
    ['Julia Nieminen','Marketing|Helsinki','','Anna; avoid Pete'],
    ['Oskari Korhonen','Engineering|Helsinki','Osku','Peter, Lucas'],
    ['Emma Wilson','Design|London','','Sarah, Sophie'],
    ['Lucas Berg','Engineering|Stockholm','','Oskari, Erik'],
    ['Sophie Martin','Design|Paris','','Emma, Olivia'],
    ['Erik Lindström','Sales|Stockholm','','Lucas, Nora'],
    ['Olivia Chen','Marketing|London','','Sophie, Anna'],
    ['Nora Andersson','Design|Stockholm','','Erik, anyone from Design'],
    ['Aino Mäkelä','Marketing|Helsinki','','Julia, Anna'],
    ['James Taylor','Engineering|London','Jim','Peter, Mike'],
    ['Isabella Rossi','Design|Paris','Bella','Sophie, Emma'],
    ['Leo Dubois','Sales|Paris','','Isabella, Sarah'],
    ['Mia Karlsson','Marketing|Stockholm','','Nora, Olivia'],
    ['Oliver Brown','Engineering|London','Ollie','James, Peter'],
    ['Ella Laine','Design|Helsinki','','Aino, Nora'],
    ['William Clark','Sales|London','Will','Sarah, Leo'],
    ['Sofia Eriksson','Marketing|Stockholm','','Mia, Anna'],
    ['Noah Müller','Engineering|Stockholm','','Lucas, Oliver'],
    ['Freya Andersen','Design|Stockholm','','Ella, Isabella'],
    ['Elias Nieminen','Sales|Helsinki','','Leo, anyone from Helsinki'],
  ]
  const attendees = rows.map(([name,groups,aliases,text],i) => ({ id: `p${i+1}`, name, groups: groups.split('|'), aliases: aliases ? aliases.split('|') : [], text }))
  return { version: 1, name: 'The autumn gathering', attendees, tables: ['Birch','Oak','Willow','Maple'].map((name,i) => ({ id: `t${i+1}`,name,capacity:6 })), clauses: attendees.flatMap(p => resolveReferences(parseReferenceList(p.text),p.id,attendees)), locks:{}, separations:[], objective:'balanced' }
}
