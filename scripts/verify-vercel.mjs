import assert from 'node:assert/strict'
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

if (process.argv[2] === '--isolated') {
  const { default: server } = await import(pathToFileURL(resolve('index.mjs')).href)
  for (const path of ['/', '/debug']) {
    const response = await server.fetch(new Request(`https://plassitin.example${path}`))
    assert.equal(response.status, 200, path)
    assert.match(await response.text(), /<html/)
  }
  const solverFile = (await readdir('_ssr')).find(name => name.startsWith('solver.server-'))
  assert.ok(solverFile, 'Packaged solver is present')
  const { solveWithTrace } = await import(pathToFileURL(resolve('_ssr', solverFile)).href)
  const result = await solveWithTrace({
    version: 1, name: 'Deployment check', objective: 'balanced',
    attendees: ['a', 'b'].map(id => ({ id, name: id, aliases: [], groups: [], text: '' })),
    tables: [{ id: 'one', name: 'One', capacity: 2 }],
    clauses: [{ id: 'request', personId: 'a', targets: ['b'], kind: 'prefer', weight: 1, state: 'resolved', reference: 'b', source: 'name' }],
    locks: {}, separations: [],
  })
  assert.equal(result.result.kind, 'plan', JSON.stringify(result.result))
  assert.deepEqual(result.result.assignments, { a: 'one', b: 'one' })
  assert.deepEqual(Object.values(result.result.seatIndices).sort(), [0, 1])
  console.log('Vercel artifact: both routes render; isolated worker/WASM solver seats both guests.')
} else {
  const directory = await mkdtemp(join(tmpdir(), 'plassitin-vercel-'))
  try {
    await cp('.vercel/output/functions/__server.func', directory, { recursive: true, dereference: true })
    const result = spawnSync(process.execPath, [resolve('scripts/verify-vercel.mjs'), '--isolated'], { cwd: directory, stdio: 'inherit', timeout: 30_000 })
    if (result.error) throw result.error
    assert.equal(result.status, 0, 'Isolated deployment check failed')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
