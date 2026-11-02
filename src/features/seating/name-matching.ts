import { normalize } from './model'
import type { Attendee } from './model'
import { parseReferenceList } from './preferences'

type NameNode={children:Map<string,NameNode>;people:Set<string>}
type NameMatch={reference:string;preference:'prefer'|'avoid'}&(
  |{state:'resolved';personId:string}
  |{state:'ambiguous';candidates:string[]}
)
function nameKeys(name:string){
  const words=normalize(name).split(' ')
  return [...new Set([normalize(name),...(words.length>1?[words[0],words[words.length-1]].filter(word=>word.length>1):[])])]
}
export function nameCandidates(reference:string,attendees:Attendee[]){
  const key=normalize(reference)
  return attendees.filter(person=>nameKeys(person.name).includes(key)).map(person=>person.id)
}
export function createNameMatcher(attendees:Attendee[]){
  const root:NameNode={children:new Map(),people:new Set()}
  for(const person of attendees)for(const key of nameKeys(person.name)){
    let node=root
    for(const word of key.split(' ')){
      let next=node.children.get(word)
      if(!next){next={children:new Map(),people:new Set()};node.children.set(word,next)}
      node=next
    }
    node.people.add(person.id)
  }
  return(text:string,owner:string):NameMatch[]=>{
    const matches:NameMatch[]=[]
    for(const part of parseReferenceList(text)){
      const tokens=[...part.reference.matchAll(/[\p{L}\p{N}\p{M}]+/gu)]
      for(let start=0;start<tokens.length;){
        let node=root,found:{end:number;people:Set<string>}|null=null
        for(let end=start;end<tokens.length;end++){
          const next=node.children.get(normalize(tokens[end][0]));if(!next)break
          node=next;if(node.people.size)found={end,people:node.people}
        }
        if(!found){start++;continue}
        const first=tokens[start],last=tokens[found.end]
        const reference=part.reference.slice(first.index,last.index+last[0].length)
        const candidates=[...found.people].filter(id=>id!==owner)
        if(candidates.length){
          const preference=/^(?:not|no)\b/i.test(part.reference)?'avoid':part.kind
          if(found.people.size===1)matches.push({reference,preference,state:'resolved',personId:candidates[0]})
          else matches.push({reference,preference,state:'ambiguous',candidates})
        }
        start=found.end+1
      }
    }
    return matches
  }
}
