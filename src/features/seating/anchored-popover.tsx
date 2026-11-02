import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

export function AnchoredPopover({ anchor, label, onClose, children, placement = 'below', autoFocus = true }: {
  anchor: HTMLElement; label: string; onClose: () => void; children: ReactNode; placement?: 'below' | 'beside'; autoFocus?: boolean
}) {
  const popup = useRef<HTMLDivElement>(null), close = useRef(onClose)
  const [position,setPosition] = useState<{ left: number; top: number } | null>(null)
  close.current = onClose
  useLayoutEffect(() => {
    const element = popup.current
    if (!element) return
    const place = () => {
      if (!anchor.isConnected) { close.current(); return }
      const rect = anchor.getBoundingClientRect(), box = element.getBoundingClientRect()
      const desiredLeft=placement==='beside'?rect.right+10:rect.left+rect.width/2-box.width/2
      const left = Math.max(12, Math.min(desiredLeft, window.innerWidth - box.width - 12))
      const below = rect.bottom + 8
      const top = placement==='beside'?(Math.max(12,rect.top)+Math.min(window.innerHeight-12,rect.bottom)-box.height)/2:below + box.height <= window.innerHeight - 12 ? below : Math.max(12, rect.top - box.height - 8)
      setPosition({ left, top: Math.max(12, Math.min(top, Math.max(12, window.innerHeight - box.height - 12))) })
    }
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !element.contains(event.target) && !anchor.contains(event.target)) close.current() }
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault();event.stopPropagation();close.current();anchor.focus() } }
    const observer = new ResizeObserver(place); observer.observe(element);observer.observe(anchor)
    place()
    window.addEventListener('resize',place);window.addEventListener('scroll',place,true)
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',keyboard,true)
    return () => { observer.disconnect();window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',keyboard,true) }
  },[anchor,placement])
  const positioned=position!==null
  useLayoutEffect(()=>{if(positioned&&autoFocus)popup.current?.querySelector<HTMLElement>('input, select, button')?.focus({preventScroll:true})},[anchor,positioned,autoFocus])
  return createPortal(<div ref={popup} className="anchored-popover" role="dialog" aria-label={label} style={{ width: placement==='beside'?180:250, left: position?.left || 0, top: position?.top || 0, visibility: position ? 'visible' : 'hidden' }} onPointerDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}>{children}</div>,document.body)
}
