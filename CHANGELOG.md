# Changelog

## 0.1.0-beta.2 (2026-11-21)

Beta installation package for DeepSeek Harness Desktop. Transparent source images are composited onto white for the AI4Scholar layer request. The canvas keeps the source image and the foreground layers retain their alpha channels.

- Replace the plugin icon with the PlotFig mark cut from the original logo, without a background tile; the P follows the sidebar text color and the leaf is burnt orange on light themes and lime on dark ones. Add the PlotFig logo to the top of both READMEs: burnt orange in light mode, lime in dark mode.

- Rename the package to `dsh-plotfig` and the interface name to PlotFig. Tool names, the `/seedream` command, the data directory `$DSH_HOME/seedream` and saved canvases are unchanged; the old `dsh-seedream` package was never published.

- Add 重新生成: redo a generated image in place, keep older versions and switch between them without a model call.
- Add `seedream_generate_batch` for 2–10 planned images in one conversation request, run in order with per-item failure reporting and no retries.
- Show the maximum reservation before a split, then keep the final charge and returned credits with the editable board.
- Route generation, edits and quoted layer tasks through AI4Scholar using the shared `AI4SCHOLAR_API_KEY`. The free 测试连接 button checks the balance and Seedream availability.

## 0.1.0-beta.1 (2026-11-19)

Local prerelease build for installation testing.

- Let the canvas composer hold up to 10 references (加入参考), numbered 图1… with the main image first; repeated edits request opaque output for consistency.
- Flag inpaint results whose drawing crossed a box edge and was cut off on restore; ask the model to keep objects and shadows inside the boxes.
- Add a 透明背景 composer toggle and `transparent` tool option for native RGBA generation, with a warning when no transparency returns.
- Add 局部重绘 (inpaint): boxed regions sent as `<bbox>` tags with a required description; pixels outside are restored from the source.
- Let 拆分图层 box regions to separate, appended to the prompt as normalized `<bbox>` tags.
- Map all 228 supported OCR fonts, including Chinese names, to category-aware CSS stacks and PSD PostScript names.
- Flag expansion passes in which the model draws a straight line parallel to the seam, such as a panel edge, found in a real test that passed every other check.
- Run multi-sided expansion as chained single-sided passes, one billed image per side, saving completed passes when a later one fails. Original pixels stay byte-identical; real three-side test passed.
- Add 变清晰 (enhance): upscale to the ~4.62 MP model limit, keep source transparency, refill areas the model changed (such as rewritten words) from the upscaled source, and always hold results for review.
- Add single-page lossless PDF export from the editor menu and the artboard toolbar, with no new dependencies.
- Standardize six base appearance presets with explicit visual rules; add naturalistic illustration and keep the former journal preset as a backwards-compatible saved value, without silently remapping existing canvases. Keep subject, figure type, viewpoint, layout, palette and effects independent.
- Use cross-disciplinary representative references in the style picker and keep six saved microscope outputs as a separate controlled visual audit. Record provenance and limitations: views and proportions drift, naturalistic and 3D are still close, and cross-subject stability is unverified. The picker update makes no model calls; the audit retains its six real paid outputs with no automatic retries.

- Add eight original, local diagram templates in four categories with three palettes, available through a compact composer button. Keep browsing separate from explicit creation, and allow templates without a drawing API key.
- Support rounded nodes, diamond decisions, editable node labels and attached arrows. Recompute endpoints after edits; preserve connection-aware copy, detach, autosave and undo/redo. Include source-free artboards in recent/all-canvas lists and allow conflict recovery as a separate copy.
- Export vector/text artboards as SVG using canvas text wrapping; retain editable node labels in PSD groups. Existing raster/OCR artboards keep their export paths. New diagram primitives require this build or later.

- Limit the home gallery to eight recent canvases and add an All canvases entry with the total count. Open the complete gallery in its own view, preserve the home draft and return destination when browsing, and remove the catalog’s 200-item truncation.

- Refine the home and standalone prompt boxes with clearer text spacing, lightweight style/size controls, a fixed model label and hints below the field. Keep size menus within narrow input bounds and measure the growing composer so canvas image actions remain clear of it.

- Simplify the home page around a working prompt box, compact tool shortcuts and recent canvases. Show style previews only after opening the composer's style button; move the standalone canvas style control into its composer too. Submit once with the selected style/size, keep the draft on failure, and remove the duplicate new-canvas gallery tile. Verify theme/narrow layouts and generation handoff with a simulated local result, without model calls.

- Add a scientific-illustration home with six tool entry points, original same-theme style swatches and six persistent visual presets. Apply per-canvas styles to browser and native-tool generation, with an explicit `auto` override; retain ordinary standalone edit appearance.
- Import PNG/JPEG locally without a model call, preserving PNG bytes and alpha. Route tools to split/cutout confirmation, existing OCR text properties, or a reference/sketch draft. Keep native conversation drafts intact and avoid automatic submission on tool or style selection.
- Validate request forwarding, per-canvas isolation, file validation, persistence, confirmations, native drafts and narrow layouts with automated, mocked-request and isolated-host checks. No new paid outputs were used for this iteration; style and sketch output quality remain unvalidated.

- Keep saved canvases accessible for local layer editing and export without an API key. Show setup initially only when there are no saved canvases; model calls still require credentials. Add regression coverage and support the current host's minified slot declarations in native-page checks.
- Complete one live OCR decomposition acceptance on 2026-11-18: 13 paid outputs, seven usable OCR layers, no automatic retries. Validate conversion, mixed Chinese/English edits, restore/undo, movement/order, reload and PNG/PSD exports; independent PSD parsing retains 13 top-level objects and 13 text records. Decorative titles can remain raster-only and model stacking can need manual adjustment. Fresh external-editor validation remains unavailable; outpainting is deferred from the initial-release acceptance scope.

- Place detailed-editor tools in a slim vertical dock on the left, with menus opening to the right. Group undo/redo with bottom zoom controls and fit the artboard within the remaining space; keep narrow property panels clear of both control groups.

- Simplify the detailed layer editor to one compact header and a floating icon toolbar. Move shapes, secondary actions and decomposition notices into dismissible menus; preserve export, autosave and keyboard shortcuts. Collapse the property panel on narrow entry and keep it clear of the toolbar.

- Edit decomposed layers directly on the main canvas: click, Shift/Cmd/Ctrl multi-select, marquee-select, drag, resize/rotate, and merge from the floating selection toolbar. Transparent PNG regions pass clicks through to lower layers. Keep decomposition in place, with an optional layer list and an explicit detailed-editor entry; reuse local autosave, undo and source assets.

- Float canvas undo/redo and zoom controls in the upper-right corner, clear of the prompt and generate button. Keep selected-image actions below the controls, place notices with the bottom composer, and reclaim the bottom spacing in narrow and conversation canvases.

- Default expansion to one side with direction shortcuts. Single-sided requests use a cropped RGB edge reference, conservative geometry alignment and a narrow exterior transition, then copy every original RGBA byte back unchanged. Keep one paid output per submission and retain multi-sided API compatibility.
- Flag mismatched edge overlaps, distorted model aspect ratios and unfilled exterior pixels before applying results to layers. Never use a cosmetic seam score to certify a structurally mismatched result.
- Real follow-up: two full-image variants failed, while a 256 px left expansion of the rainforest sample passed visual review with zero original pixels changed. Three new paid outputs, no automatic retries. Other sides have synthetic and simulated UI coverage; broader live-image validation remains pending.

- Add background removal, brush/rectangle erase with subtraction and undo/redo, and four-sided outpainting to canvas images and editable image layers; expose the same operations through `seedream_edit`.
- Restore exact original RGBA pixels outside erase masks and inside the original outpainting rectangle. Preserve the placement of scaled/rotated layers, immutable originals, undoable replacement and late results; reuse completed request ids and never retry a billed request automatically.
- Export layered PSD with names, stacking order, opacity, hidden/locked state, off-artboard content, composite previews and optional native text/OCR runs. Keep a text-as-pixels mode for appearance compatibility; vector shapes export as individual pixel layers and native font layout is approximate.
- Refine cutout prompts and white-matte edge colors, add inward-only erase feathering (0–64 px), and use a single transparent guide for outpainting. Persist review warnings for changed expansion anchors and prevent automatic layer replacement for flagged results; original RGBA pixels remain exact. Complex infographic outpainting remains unreliable.
- Map common fonts to PostScript names and save explicit Latin/CJK font runs in PSD text. Fonts are not embedded; target software may substitute missing fonts.
- Test pixel preservation, alpha blending, validation, per-Session access, duplicate/failed/cancelled requests, result rescue and PSD binary roundtrips using synthetic pixels and mocked API responses. Real checks on 2026-11-14 used 3 initial images and 4 candidate images with no automatic retries. Cutout quality improved, cached erase output was locally recomposed, and the complex infographic expansion did not pass visual review. Photopea text editing/save/reopen was tested; Photoshop was not.

- Convert OCR-bearing text layers to locally editable rich text with per-line positioning and per-run font, color, weight, decoration, shadow and transparency controls.
- Preserve moved/scaled/rotated layer geometry, immutable original text PNGs, comparison/restoration, undo/redo and autosave; use the same text layout for the canvas, composites and PNG exports.
- Validate OCR coordinates, rich text and backup asset references per Session. Existing layers without usable OCR remain raster images; exact font matching is not guaranteed.

- Add Seedream layer decomposition with output limits, preserved bounding-box/OCR metadata, partial-download warnings, immutable original images and late-result persistence.
- Add editable artboards with independent movement outside the artboard, resize/rotation, text and shape overlays, multi-select, alignment, automatic arrangement, merging, stacking order, hide/lock and undo/redo.
- Autosave validated per-Session compositions with independent revisions; detect concurrent edits and recover local changes as a separate copy.
- Export artboard or selected content as PNG, preserve transparency, save composites to the canvas and reference them into the native conversation draft. Local editing does not invoke the model.
- Keep existing canvas data compatible. Artboards use the optional `compositions` field; layer assets are immutable and retained when an artboard is deleted. PDF export remains out of scope.
- Validate this iteration using cached real layer assets and simulated API responses; no new billable image-generation/decomposition requests.

- Use the native DSH conversation composer for conversation canvases. Examples, image edits and references prepare the same Session's draft without sending; standalone boards keep their direct-generation composer.
- Preserve structured draft references, quotes and attachments with the host's append API; protect drafts during all submission phases, including `sending`.
- Reopen gallery conversation canvases in their original native Session and reveal the right canvas only after that Session mounts. Background generations cannot open another conversation's canvas.
- Fall back to copying on older hosts without safe draft initialization; do not rewrite their structured drafts as plain text.

## 0.1.0

The first local build was tested with live Seedream requests and the Harness 0.2.2-rc web and desktop hosts.

- Tools `seedream_generate` (text-to-image and editing with up to 10 references: canvas items, https URLs, local paths) and `seedream_canvas` (list, no charge), plus the `/seedream` command.
- Conversation canvases: one per conversation, opened in the right Sidebar from the conversation header (Harness ≥ 0.2.2). The canvas opens on its own when the conversation starts a generation, and shows a timed placeholder until the image arrives.
- Standalone canvases: "新建画布" in the Seedream panel, saved on the first image.
- Canvas: dot-grid background, pan and zoom, drag to move with undo/redo, fit to window (⌘0), selection handles and hover outline. New results are zoomed into and selected.
- Prompt box: auto-growing, Enter to send, stop while waiting, and a size menu with seven 2K aspect ratios or 1K/1.5K/2K tiers.
- Image actions: edit in place with the source image shown as context, reference into the conversation draft, download, delete with inline confirmation.
- Seedream panel lists every canvas, with type, image count, recency and a running badge.
- Readable image titles from the first clause of the prompt.
- Added settings for the drawing API key, default image size, and watermark. The watermark defaults to on.
- Not included yet: layer decomposition, text and shape overlays, background removal, erase, outpainting, upscaling.
