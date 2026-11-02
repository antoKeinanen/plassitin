# Candidate rubric

Score 1–5: complete state restoration; encoded length; simple API/ownership; failure and race handling; schema evolution and testability. Screen against architect design red flags before synthesis.

Two structurally distinct candidates: packed semantic state versus full EditorDocument compression. Prefer measured compactness without reconstructing lossy interpretation. Keep Workspace as state owner. Local storage remains fallback; current hash wins. Replace download controls with Copy link; automatically reflect edits in address bar. Raw DEFLATE and unpadded base64url can avoid gzip wrappers and URL percent escapes.
