# dsh-seedream

Volcengine Ark **Seedream 5.5** (`doubao-seedream-5-5-261028`) image generation and editing for DeepSeek Harness, on a pannable, zoomable canvas. There are two kinds of canvas:

- **Conversation canvas**: one per conversation. Images generated in the conversation land on it, and it opens in the right Sidebar when a generation starts (Harness ≥ 0.2.2).
- **Standalone canvas**: created from the Seedream panel with "新建画布". It belongs to no conversation.

```bash
dsh plugin add dsh-seedream
```

Save an Ark API key under Settings → Seedream (credential `ARK_API_KEY`). Then use `/seedream <description>`, ask the assistant to draw, or create a canvas and type into its prompt box. The size menu offers seven aspect ratios at 2K, or a resolution tier that lets the model choose the shape. Select an image to edit it (Tab), reference it into the conversation draft (conversation canvases only), download it, or delete it.

Each generation is billed per output image by Ark and is never retried automatically. Result URLs expire after 24 hours, so images are downloaded at once to `$DSH_HOME/seedream/canvases/<canvas id>/` (owner-only files). The watermark is on by default, matching Ark; it can be turned off in settings.

Not yet implemented: layer decomposition, text and shape overlays, background removal, erase, outpainting, upscaling. The dark theme has not been reviewed. See [README_CN.md](README_CN.md) for the full guide and shortcuts.
