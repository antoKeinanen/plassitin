import { useEffect, useId, useRef, useState } from 'react'
import { normalize } from './model'
import type { Attendee, Clause } from './model'
import { isChipClause, isInferredNameClause, referenceKey } from './editor'
import { nameCandidates } from './name-matching'
import { AnchoredPopover } from './anchored-popover'
import { searchChips } from './chip-search'
import type { Decision, EditorDocument } from './editor'

export function AttendeeRow({ person, document, selected, onHover, onSelect, onUpdate, onRemove, onLink, onRemoveLink, onDecision, autoFocus }: {
  onHover: (ids: string[]) => void; person: Attendee; document: EditorDocument; selected: boolean; onSelect: () => void
  onUpdate: (person: Attendee) => void; onRemove: () => void
  onLink: (id: string) => void; onRemoveLink: (id: string) => void; onDecision: (clause: Clause, decision: Decision) => void
  autoFocus: boolean
}) {
  const [name,setName] = useState(person.name), [message,setMessage] = useState(person.text)
  const [query,setQuery] = useState(''), [focused,setFocused] = useState(false), [review,setReview] = useState<{ id: string; anchor: HTMLButtonElement } | null>(null)
  const [activeOption,setActiveOption]=useState<string|null>(null)
  const listId=useId(),resultList=useRef<HTMLDivElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null), nameInput = useRef<HTMLInputElement>(null), chipInput = useRef<HTMLInputElement>(null)
  useEffect(() => { setName(person.name);setMessage(person.text) },[person.name,person.text])
  useEffect(() => { if (textarea.current) { textarea.current.style.height='0px';textarea.current.style.height=`${Math.max(40,textarea.current.scrollHeight)}px` } },[message])
  useEffect(() => { if(autoFocus){nameInput.current?.focus();nameInput.current?.select()} },[autoFocus])
  useEffect(()=>{resultList.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'})},[activeOption])
  const clauses=document.event.clauses.filter(c=>c.personId===person.id&&!isChipClause(c)&&c.state!=='ignored')
  const personTargets=[...new Set([...(document.links[person.id]||[]),...clauses.flatMap(c=>c.state==='resolved'&&c.kind==='prefer'&&c.targets.length===1?c.targets:[])])]
  const otherClauses=clauses.filter(c=>c.state==='unresolved'||c.kind==='avoid'||c.state==='resolved'&&c.targets.length>1)
  const codes=[...new Set(document.event.attendees.flatMap(p=>p.groups))]
  const {options:suggestions}=searchChips({query,person,attendees:document.event.attendees,excludedPersonIds:personTargets})
  const offerNewOption=!codes.some(code=>normalize(code)===normalize(query.replace(/^#+/,'')))
  const addCode=(value:string)=>{
    const trimmed=value.trim().replace(/^#+/,'').trim().slice(0,100)
    if(!trimmed)return
    const canonical=codes.find(c=>normalize(c)===normalize(trimmed))||trimmed
    if(!person.groups.some(c=>normalize(c)===normalize(canonical))&&person.groups.length<20)onUpdate({...person,groups:[...person.groups,canonical]})
    setQuery('');setFocused(false)
  }
  const addQuery=()=>{
    if(!query.trim())return
    const exact=document.event.attendees.filter(p=>p.id!==person.id&&[p.name,...p.aliases,p.name.split(' ')[0]].some(n=>normalize(n)===normalize(query)))
    if(!query.startsWith('#')&&exact.length===1){onLink(exact[0].id);setQuery('');setFocused(false)}else addCode(query)
  }
  const choices=suggestions.map(item=>({key:`${item.kind}:${item.value}`,label:item.label,select:()=>{
    if(item.kind==='person'){onLink(item.value);setQuery('');setFocused(false)}
    else addCode(item.value)
  }}))
  if(offerNewOption)choices.push({key:'create',label:`Use #${query.replace(/^#+/,'')}`,select:()=>addCode(query)})
  const searchOpen=focused&&Boolean(query),activeIndex=choices.findIndex(option=>option.key===activeOption)
  return <tr data-person-id={person.id} className={selected?'selected-row':''} onFocus={onSelect} onMouseEnter={()=>onHover([person.id])} onMouseLeave={()=>onHover([])}>
    <td className="name-cell"><input ref={nameInput} aria-label={`Name for ${person.name}`} value={name} maxLength={150} placeholder="Name" onChange={e=>setName(e.target.value)} onBlur={()=>{if(name.trim()){if(name.trim()!==person.name)onUpdate({...person,name:name.trim()})}else setName(person.name)}}/><button className="remove-row" type="button" onClick={onRemove} disabled={document.event.attendees.length===1} aria-label={`Remove ${person.name}`}>Remove</button></td>
    <td><textarea ref={textarea} aria-label={`Preference message for ${person.name}`} value={message} maxLength={5000} rows={1} placeholder="Preference message" onChange={e=>setMessage(e.target.value)} onBlur={()=>{if(message!==person.text)onUpdate({...person,text:message})}}/></td>
    <td className="connections-cell"><div className="chip-field">
      {person.groups.map(code=><button className="connection-chip code-chip" onMouseEnter={()=>onHover(document.event.attendees.filter(p=>p.groups.some(group=>normalize(group)===normalize(code))).map(p=>p.id))} onMouseLeave={()=>onHover([person.id])} key={`code:${code}`} title={`Remove shared code ${code}`} aria-label={`Remove code ${code} from ${person.name}`} onClick={()=>onUpdate({...person,groups:person.groups.filter(c=>c!==code)})}>#{code}</button>)}
      {personTargets.map(id=>{const target=document.event.attendees.find(p=>p.id===id);return target?<button className="connection-chip person-chip" onMouseEnter={()=>onHover([id])} onMouseLeave={()=>onHover([person.id])} key={`person:${id}`} title={`Remove preference for ${target.name}`} aria-label={`Remove match ${target.name} from ${person.name}`} onClick={()=>onRemoveLink(id)}>{target.name}</button>:null})}
      {otherClauses.map(clause=>{
        const decision=document.decisions[referenceKey(clause)]
        const label=decision?.kind==='reference'?decision.reference:decision?.kind==='code'?'#'+decision.code:decision?.kind==='person'?document.event.attendees.find(p=>p.id===decision.personId)?.name||clause.reference:clause.reference
        const inferred=isInferredNameClause(clause)&&clause.state==='unresolved'
        const ambiguous=inferred&&nameCandidates(clause.reference,document.event.attendees).length>1
        const reviewLabel=ambiguous?`Resolve ambiguous name ${clause.reference} for ${person.name}`:`Review name ${clause.reference} for ${person.name}`
        return <div className="reference-chip-wrap" key={clause.id}><button className={`connection-chip reference-chip ${clause.state==='unresolved'?'unmapped-chip':''} ${clause.kind==='avoid'?'avoid-chip':''}`} onMouseEnter={()=>onHover(clause.state==='resolved'?clause.targets:[])} onMouseLeave={()=>onHover([person.id])} onClick={e=>setReview(review?.id===clause.id?null:{id:clause.id,anchor:e.currentTarget})} aria-label={inferred?reviewLabel:`Map reference ${clause.reference} for ${person.name}`} title={inferred?reviewLabel:undefined} aria-expanded={review?.id===clause.id}>{clause.kind==='avoid'?'Avoid ':''}{label}{inferred?(ambiguous?' (ambiguous)':' (review)'):''}</button>{review?.id===clause.id&&<AnchoredPopover anchor={review.anchor} label={`Edit reference for ${person.name}`} onClose={()=>setReview(null)}><ReferenceEditor key={clause.id} clause={clause} attendees={document.event.attendees} onDecision={decision=>{onDecision(clause,decision);setReview(null)}} onClose={()=>setReview(null)}/></AnchoredPopover>}</div>
      })}
      <div className="chip-entry"><input ref={chipInput} role="combobox" aria-autocomplete="list" aria-expanded={searchOpen} aria-controls={searchOpen?listId:undefined} aria-activedescendant={searchOpen&&activeIndex>=0?`${listId}-${activeIndex}`:undefined} aria-label={`Names or codes for ${person.name}`} placeholder="Name or #tag" title="Enter a name or a shared tag" value={query} maxLength={100} onChange={e=>{setQuery(e.target.value);setActiveOption(null);setFocused(true)}} onFocus={()=>{setFocused(true);setActiveOption(null)}} onBlur={()=>setTimeout(()=>setFocused(false),120)} onKeyDown={e=>{
        if(e.nativeEvent.isComposing)return
        if((e.key==='ArrowDown'||e.key==='ArrowUp')&&query&&choices.length){
          e.preventDefault();setFocused(true)
          const start=searchOpen?activeIndex:-1
          const index=start<0?(e.key==='ArrowDown'?0:choices.length-1):(start+(e.key==='ArrowDown'?1:-1)+choices.length)%choices.length
          setActiveOption(choices[index].key)
        }else if(e.key==='Enter'||e.key===','){
          e.preventDefault()
          if(e.key==='Enter'&&searchOpen&&activeIndex>=0)choices[activeIndex].select();else addQuery()
          setActiveOption(null)
        }else if(e.key==='Escape'){setFocused(false);setActiveOption(null)}
        else if(e.key==='Backspace'&&!query){const last=person.groups.at(-1);if(last)onUpdate({...person,groups:person.groups.slice(0,-1)})}
      }}/>
      {searchOpen&&chipInput.current&&<AnchoredPopover anchor={chipInput.current} label="Chip search" autoFocus={false} onClose={()=>{setFocused(false);setActiveOption(null)}}><div ref={resultList} id={listId} className="chip-suggestions" role="listbox" aria-label={`Matches for ${query}`} onMouseDown={e=>e.preventDefault()}>{choices.map((item,index)=><button id={`${listId}-${index}`} role="option" tabIndex={-1} aria-selected={index===activeIndex} type="button" key={item.key} onMouseEnter={()=>setActiveOption(item.key)} onClick={()=>{item.select();setActiveOption(null)}}>{item.label}</button>)}</div></AnchoredPopover>}
      </div>
    </div></td>
  </tr>
}

function ReferenceEditor({clause,attendees,onDecision,onClose}:{clause:Clause;attendees:Attendee[];onDecision:(decision:Decision)=>void;onClose:()=>void}){
  const candidates=isInferredNameClause(clause)&&clause.state==='unresolved'?nameCandidates(clause.reference,attendees):[]
  const choices=attendees.filter(p=>p.id!==clause.personId&&(!candidates.length||candidates.includes(p.id)))
  return <div className="reference-editor"><select aria-label={`Map ${clause.reference} to attendee`} defaultValue="" onChange={e=>onDecision({kind:'person',personId:e.target.value})}><option value="" disabled>Map to a name</option>{choices.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select><div className="popover-actions"><button type="button" onClick={()=>onDecision({kind:'ignore'})}>Remove</button><button type="button" onClick={onClose}>Close</button></div></div>
}
