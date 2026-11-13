# dsh-seedream

Volcengine Ark **Seedream 5.5** (`doubao-seedream-5-5-261028`) image generation and editing for DeepSeek Harness, on a pannable, zoomable canvas. There are two kinds of canvas:

- **Conversation canvas**: one per conversation. Images generated in the conversation land on it, and it opens in the right Sidebar when a generation starts (Harness ≥ 0.2.2).
- **Standalone canvas**: created from the Seedream panel with "新建画布". It belongs to no conversation.

```bash
dsh plugin add dsh-seedream
```

Save an Ark API key under Settings → Seedream (credential `ARK_API_KEY`). Then use `/seedream <description>`, ask the assistant to draw, or create a canvas and type into its prompt box. The size menu offers seven aspect ratios at 2K, or a resolution tier that lets the model choose the shape. Select an image to edit it (Tab), reference it into the conversation draft (conversation canvases only), download it, or delete it.

Conversation canvases share the native DSH composer: examples, edits and references append to the same Session's draft without submitting it or replacing structured references and attachments. Opening a conversation canvas from the gallery returns to its original conversation with the canvas on the right. Only standalone canvases have a direct-generation prompt box. Older hosts without structured draft initialization fall back to copying the prompt/reference for manual pasting.

Each generation is billed per output image by Ark and is never retried automatically. Result URLs expire after 24 hours, so images are downloaded at once to `$DSH_HOME/seedream/canvases/<canvas id>/` (owner-only files). The watermark is on by default, matching Ark; it can be turned off in settings.

Select **分图层** to split one image into a locked background and editable transparent layers. Choose a maximum of 2–100 output images (default 30, background included); this operation is billed by Ark. The original stays intact, partial download failures keep the remaining results, and closing the view does not discard a completed split. `seedream_decompose` exposes the same operation to the conversation agent.

Open **编辑图层** to move objects beyond the artboard, resize, rotate, add text/rectangles/ellipses, multi-select, align, arrange, merge, change stacking order, hide or lock layers. These edits, undo/redo, and PNG exports are local and make no model calls. **加文字 / 图形** creates a local artboard without splitting. Edits autosave; concurrent changes are detected and can be saved as a separate copy. Export the artboard or selected content (including transparency), save a composite to the canvas, or reference it back into the native draft. Existing canvas files remain readable; new artboards are stored in an optional `compositions` field and layer assets stay immutable.

Limits: 500 objects per artboard and 32 million pixels per PNG export. Undo history lasts for the current run. OCR-bearing raster layers can be converted to locally editable rich text by double-clicking or choosing **编辑识别文字**. Edit each line and style run, compare the retained original PNG, or restore it with undo support. Existing transforms, stacking order and autosaved edits survive conversion and reload. OCR has approximate styles and no exact font size: local font fallback and estimated sizing may change the appearance. Layers without usable OCR retain their original raster. Background removal, erase, outpainting, upscaling and PSD/PDF export are not included. Validation uses cached decomposition assets, the public [Volcengine OCR sample](https://docs.volcengine.com/docs/ark/seedream-5-5?lang=zh), and mocked API responses, without new billable model requests. See [README_CN.md](README_CN.md) for the full guide and shortcuts.
