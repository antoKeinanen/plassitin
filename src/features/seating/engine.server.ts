import type { Attendee } from './model'
import { extractedSchema, parseReferenceList, resolveReferences } from './preferences'

export async function interpret(input: { personId: string; text: string; attendees: Attendee[] }) {
  if (!input.attendees.some(p => p.id === input.personId)) throw new Error('Choose a registered attendee.')
  const endpoint = process.env.PREFERENCE_EXTRACTOR_URL
  let references = parseReferenceList(input.text)
  if (endpoint) {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(process.env.PREFERENCE_EXTRACTOR_TOKEN ? { Authorization: `Bearer ${process.env.PREFERENCE_EXTRACTOR_TOKEN}` } : {}) }, body: JSON.stringify({ text: input.text }), signal: AbortSignal.timeout(20000) })
    if (!response.ok) throw new Error('AI interpretation failed. Your request has not been changed. Try again or use manual review.')
    const body = await response.text()
    if (body.length > 100000) throw new Error('The extraction service returned too much data.')
    references = extractedSchema.parse(JSON.parse(body))
  }
  return { clauses: resolveReferences(references,input.personId,input.attendees), mode: endpoint ? 'ai' : 'lists' }
}
