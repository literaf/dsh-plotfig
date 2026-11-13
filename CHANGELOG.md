# Changelog

## Unreleased

- Convert OCR-bearing text layers to locally editable rich text with per-line positioning and per-run font, color, weight, decoration, shadow and transparency controls.
- Preserve moved/scaled/rotated layer geometry, immutable original text PNGs, comparison/restoration, undo/redo and autosave; use the same text layout for the canvas, composites and PNG exports.
- Validate OCR coordinates, rich text and backup asset references per Session. Existing layers without usable OCR remain raster images; exact font matching is not guaranteed.

- Add Seedream layer decomposition with output limits, preserved bounding-box/OCR metadata, partial-download warnings, immutable original images and late-result persistence.
- Add editable artboards with independent movement outside the artboard, resize/rotation, text and shape overlays, multi-select, alignment, automatic arrangement, merging, stacking order, hide/lock and undo/redo.
- Autosave validated per-Session compositions with independent revisions; detect concurrent edits and recover local changes as a separate copy.
- Export artboard or selected content as PNG, preserve transparency, save composites to the canvas and reference them into the native conversation draft. Local editing does not invoke the model.
- Keep existing canvas data compatible. Artboards use the optional `compositions` field; layer assets are immutable and retained when an artboard is deleted. PSD/PDF export remains out of scope.
- Validate this iteration using cached real layer assets and simulated API responses; no new billable image-generation/decomposition requests.

- Use the native DSH conversation composer for conversation canvases. Examples, image edits and references prepare the same Session's draft without sending; standalone boards keep their direct-generation composer.
- Preserve structured draft references, quotes and attachments with the host's append API; protect drafts during all submission phases, including `sending`.
- Reopen gallery conversation canvases in their original native Session and reveal the right canvas only after that Session mounts. Background generations cannot open another conversation's canvas.
- Fall back to copying on older hosts without safe draft initialization; do not rewrite their structured drafts as plain text.

## 0.1.0

First version. Not published yet; tested locally against real Ark requests and the Harness 0.2.2-rc web and desktop hosts.

- Tools `seedream_generate` (text-to-image and editing with up to 10 references: canvas items, https URLs, local paths) and `seedream_canvas` (list, no charge), plus the `/seedream` command.
- Conversation canvases: one per conversation, opened in the right Sidebar from the conversation header (Harness ≥ 0.2.2). The canvas opens on its own when the conversation starts a generation, and shows a timed placeholder until the image arrives.
- Standalone canvases: "新建画布" in the Seedream panel, saved on the first image.
- Canvas: dot-grid background, pan and zoom, drag to move with undo/redo, fit to window (⌘0), selection handles and hover outline. New results are zoomed into and selected.
- Prompt box: auto-growing, Enter to send, stop while waiting, and a size menu with seven 2K aspect ratios or 1K/1.5K/2K tiers.
- Image actions: edit in place with the source image shown as context, reference into the conversation draft, download, delete with inline confirmation.
- Seedream panel lists every canvas, with type, image count, recency and a running badge.
- Readable image titles from the first clause of the prompt.
- Settings: Ark key, default size, watermark (on by default, as in Ark).
- Not included yet: layer decomposition, text and shape overlays, background removal, erase, outpainting, upscaling.
