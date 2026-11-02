# Existing runtime

The application is a TanStack Start server-rendered React application. `src/router.tsx` creates the router from a generated route tree. `src/routes/__root.tsx` owns the HTML document, metadata, and stylesheet; `src/routes/index.tsx` is the sole page. Vite's TanStack Start plugin builds separate client and server bundles.

There is no existing domain model, persistence, authentication, API, or seating engine to preserve. The new UI should use the existing route and CSS entrypoint. Domain inputs must be validated at browser storage and server-function boundaries. Secrets and optimization execution must remain in server-only modules. This is a greenfield domain inside an existing web shell.
