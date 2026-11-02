import { useEffect, useRef, useState } from 'react'
import type { Attendee } from './model'
import { parsePastedAttendees } from './files'

export function ImportDialog({onImport,onClose}:{onImport:(attendees:Attendee[])=>void;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null)
  const [text,setText]=useState(''),[error,setError]=useState('')
  const [preview,setPreview]=useState<Attendee[]|null>(null)
  useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close()},[])
  function showPreview(){
    try{setPreview(parsePastedAttendees(text));setError('')}
    catch(error){setError(error instanceof Error?error.message:'The CSV could not be read.')}
  }
  function submit(){
    if(!preview){showPreview();return}
    try{onImport(preview)}catch{setError('These preferences exceed the import limits. Go back and shorten the messages.')}
  }
  return <dialog ref={dialog} className="import-dialog" aria-label="Import attendees" onCancel={onClose}>
    <form onSubmit={e=>{e.preventDefault();submit()}}>
      {preview?<div className="import-preview"><table><thead><tr><th scope="col">Name</th><th scope="col">Preference message</th></tr></thead><tbody>{preview.map(person=><tr key={person.id}><td>{person.name}</td><td>{person.text}</td></tr>)}</tbody></table></div>:<label className="csv-input-label">CSV<textarea aria-label="Attendee CSV" value={text} onChange={e=>{setText(e.target.value);setError('')}} placeholder={'name,preferences\nAnna,"Mike, Sarah or my friends"\nMike,Anna'} autoFocus spellCheck={false}/></label>}
      {error&&<p className="import-error" role="alert">{error}</p>}
      {preview&&<p className="import-replace-note">Importing replaces the current attendees, preferences, and seating assignments.</p>}
      <div className="import-actions">
        {preview&&<button type="button" onClick={()=>{setPreview(null);setError('')}}>Back</button>}
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="submit" disabled={!preview&&!text.trim()}>{preview?'Import attendees':'Preview'}</button>
      </div>
    </form>
  </dialog>
}
