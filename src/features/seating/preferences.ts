import { z } from 'zod'
import { normalize } from './model'
import type { Attendee, Clause } from './model'

export const extractedSchema = z.array(z.object({ reference: z.string().trim().min(1).max(5000), kind: z.enum(['prefer','avoid']), weight: z.number().int().min(1).max(5) })).max(50)
export type ExtractedReference = z.infer<typeof extractedSchema>[number]

export function parseReferenceList(text: string): ExtractedReference[] {
  if (!text.trim() || /^(no preference[s]?|i don.t care|anyone|no one|nobody|none)[.!]?$/i.test(text.trim())) return []
  let kind: 'prefer' | 'avoid' = 'prefer'
  return text.split(/[,;\n]+|\.(?:\s|$)|\band\b/gi).map(part => part.trim()).filter(Boolean).map(part => {
    if (/\b(avoid|not with|not next to|don.t.*sit with|rather not|preferably not)\b/i.test(part)) kind = 'avoid'
    else if (/^(prefer|with|sit with|i.d|i would|anyone|someone)/i.test(part)) kind = 'prefer'
    const reference = part.replace(/^(?:(?:i.d|i would|i)\s+(?:love|like|want|prefer)\s+to\s+sit\s+with|please\s+(?:seat|put)\s+me\s+with|preferably not|prefer not|not with|avoid|with|sit with|prefer)\s*:?\s*/i,'').trim()
    return { reference: reference || part, kind, weight: 1 }
  })
}

export function resolveReferences(references: ExtractedReference[], personId: string, attendees: Attendee[]): Clause[] {
  return references.map((item,index) => {
    const base = { ...item, id: `${personId}-${crypto.randomUUID()}-${index}`, personId }
    // Chair position and acquaintance claims cannot be inferred from table/group membership.
    if (/\b(next to|adjacent|opposite|someone i know|anyone i know|all of|whole|entire)\b/i.test(item.reference)) return { ...base, state: 'unresolved' }
    const alternatives = item.reference.split(/\s+or\s+/i)
    const targets = new Set<string>()
    for (const reference of alternatives) {
      const query = normalize(reference)
      const people = attendees.filter(p => [p.name, ...p.aliases, p.name.split(' ')[0]].some(name => normalize(name) === query))
      if (people.length === 1) targets.add(people[0].id)
      else return { ...base, state: 'unresolved' }
    }
    targets.delete(personId)
    return targets.size ? { ...base, state: 'resolved', targets: [...targets] } : { ...base, state: 'unresolved' }
  })
}
