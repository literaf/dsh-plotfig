# Repository instructions

- This repository contains `dsh-seedream`. Do not publish, push or create a remote repository unless the user requests it.
- Every Seedream generation is billed per output image. Never retry billable requests automatically, and keep a result that arrives after the caller stopped waiting.
- Result URLs expire after 24 hours: download bytes immediately and serve only local files to the canvas.
- One canvas per Session. Tools take the Session from `exec.agent.id`; browser routes take it from the query and may reference canvas items and https URLs only, never local paths.
- Keep the Ark key in the host credential service under `ARK_API_KEY`. The model id is fixed to Seedream 5.5.
- Do not bump versions for routine fixes. Distinguish simulated UI checks from real API tests when reporting results.

- Follow [RELEASING.md](RELEASING.md) for versioning, release checks, and publication verification.
