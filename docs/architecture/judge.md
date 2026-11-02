# Architecture cross-judge

The revised arena compared an npm-managed HiGHS WebAssembly engine with a custom TypeScript search. HiGHS was selected for mature mathematical optimization and truthful proof statuses while keeping one application runtime.

Review required three concrete checks: reject oversized models before relationship allocation, run a real optimization through the production web build, and remove the abandoned runtime and setup artifacts. The selected design keeps domain model construction in TypeScript and runs synchronous WebAssembly search inside a bounded Node worker.
