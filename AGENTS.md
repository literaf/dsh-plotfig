# Repository instructions

- This repository contains `dsh-plotfig` (PlotFig), formerly `dsh-seedream`. Internal ids (`seedream` cordis id, tab ids, tool names, `/seedream`, the `$DSH_HOME/seedream` data directory) keep their old names so existing canvases and settings keep working. Do not publish, push or create a remote repository unless the user requests it.
- AI4Scholar bills single-image generation per image and layer tasks by delivered raster count and resolution, up to the confirmed reservation. Never retry billable requests automatically, and keep a result that arrives after the caller stopped waiting.
- Result URLs expire after 24 hours: download bytes immediately and serve only local files to the canvas.
- One canvas per Session. Tools take the Session from `exec.agent.id`; browser routes take it from the query and may reference canvas items and https URLs only, never local paths.
- Use only the shared host credential `AI4SCHOLAR_API_KEY`. All authenticated drawing requests go to `https://ai4scholar.net`. Prompt generation and reference edits default to Seedream 5.5 and accept the models supported by the AI4Scholar drawing canvas. Layer splitting and specialized image operations use Seedream.
- Do not bump versions for routine fixes. Distinguish simulated UI checks from real API tests when reporting results.

- Follow [RELEASING.md](RELEASING.md) for versioning, release checks, and publication verification.
