import { useEffect, useRef } from 'react'

export function ClearDialog({onClear,onClose}:{onClear:()=>void;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null)
  useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close()},[])
  return <dialog ref={dialog} className="clear-dialog" aria-label="Clear all data" aria-describedby="clear-state-description" onCancel={onClose}>
    <p id="clear-state-description">Remove all attendees, messages, preferences, and placements, and reset the tables? This also clears the saved seating and solver history in this browser. This cannot be undone.</p>
    <div className="clear-actions"><button type="button" autoFocus onClick={onClose}>Cancel</button><button type="button" className="danger-button" onClick={onClear}>Clear all</button></div>
  </dialog>
}
