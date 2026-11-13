# Changelog

## Unreleased

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
