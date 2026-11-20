# dsh-seedream 验收记录

按时间记录每轮开发的验证方式和结果。区分真实付费接口测试与模拟测试；“无自动重试”指每张付费图片只提交一次。这个文件只保存在本地仓库里，不进入 npm 发布包。新的验收记录追加到末尾。

## 中文记录

图层编辑使用已缓存的真实分层素材验证；文字和 PSD 使用火山官方公开 OCR 示例验证。自动测试和界面流程使用模拟返回值。2026-11-14 另完成首轮 3 张、修正候选 4 张真实付费图片测试，无自动重试：风机去背景效果改善；消除过渡复用已付费结果在本地检查；复杂雨林说明图的扩图效果仍未通过。PSD 已在 Photopea 验证改字、保存和重开；本机没有 Photoshop，另用 Adobe Illustrator 2025 导入验证（见下方 2026-11-19 记录），尚未在 Photoshop 中验收。

最新扩图验证（2026-11-14/15）：新增 3 张真实付费候选，无自动重试。两种整图方案未通过；雨林向左 256 像素的局部参考方案通过整体及三处边缘放大检查，原图 1664×2496 区域改变像素为 0。此前桌面消除复测另用 1 张真实图片，成功保存中英文标题、PNG 和可编辑 PSD。

最新分层验收（2026-11-18）：一次开启 OCR、最多 16 张的真实请求返回 13 张图片，其中 7 个图层有可用 OCR，全部下载并保留原图，无自动重试。使用本机宿主页面验证了全部 7 层文字转换、中英文改字、原图对照与恢复、撤销重做、图层移动与顺序调整、刷新重开，以及 PNG 和两种 PSD 导出。独立 PSD 解析保留了 13 个顶层对象和 13 条可编辑文字记录。模型给出的遮挡顺序需要手动调整，大号装饰标题没有返回 OCR，仍保留为图片层。另对已有 5 组真实素材、125 个图层做了本地回放，不能算作新的 API 测试。新 PSD 已做独立重合成检查；当日 Photopea 连接不可用，尚未用外部编辑器复验这批新文件，之前的 Photopea 结果也不能代表 Photoshop 兼容性。

科研工具与风格入口验证（2026-11-18）：通过自动测试、模拟生图请求和隔离的真实宿主界面检查了风格持久化、参数传递、PNG/JPEG 导入、操作确认、原生草稿追加和窄窗口布局。这轮新增界面没有产生付费生图；不能据此视为六种风格或草图生成效果的实测。

本地图形模板验收（2026-11-18）：在无方舟 Key 的隔离宿主中创建并导出全部 8 个模板，检查中英文改字、拖动后连线更新、撤销重做、自动保存与刷新重开，付费接口调用为 0。138 项测试通过，明暗主题及 320／420／768 像素窗口通过界面检查。SVG 按浏览器重渲染对照 PNG；两份 PSD 通过独立解析和图层重合成验证，分别保留 9 和 7 条可编辑文字记录。尚未在 Photoshop 中验收这批模板。

收尾验收（2026-11-19）：共 4 张真实付费图片，无自动重试。雨林图同时向右、上、下各扩 256 像素，链式 3 步生成 1920×3008，原图 1664×2496 区域改变像素为 0，未触发需检查提示；整体与五处接缝放大检查未见矩形接缝，新增区域延续了树冠、天空和蕨类。雨林图缩小到 640×960 后变清晰得到 1755×2634：树叶、枝干和大标题明显比双三次放大清楚，但小字有改写（canopy→canegy、exposed→expased、eagles→cagles、wide-ranging→with-ranging），因此加入了改动还原：同一张结果经本地处理后约 13% 的区域用原图放大还原，上述四个词全部恢复正确，代价是这些区域比其他区域略模糊。PDF 用 poppler（pdfinfo、pdfimages）和 macOS Quartz 打开，页面 1664×2496 pt，内嵌图像与原图逐像素一致，透明蒙版生效。Photoshop 兼容性：本机未安装 Photoshop；已有两份导出 PSD 用 Adobe Illustrator 2025 导入，13 和 9 条文字均识别为可编辑文字对象，字体名正确；psd-tools 1.27 独立重合成与内嵌预览平均差 0.02。PSD 未嵌入字体，Barlow、Cal Sans 等本机未装的字体在 Photoshop 中会被替换。

发布前检查（2026-11-19，提交 `2278669` 的干净克隆）：Node 22.23.5 与 24.5.0 下类型检查、构建和 162 项测试通过；`prepublishOnly` 通过；当前 Harness 0.2.2-rc.5 的原生页面兼容测试 2 项通过。发布包 1.8 MB，只含 `lib`、`assets` 与说明文件，未发现测试素材、本机路径或凭据。尚未发布到 npm。

扩图与去背景补充测试（2026-11-19）：6 类图共 15 张真实付费图片，无自动重试。扩图 6 例 10 步，原图区域改变像素均为 0：风机向上、血脑屏障图向下、荧光细胞向左、线稿移液器左右两侧都自然衔接；光学平台四侧扩展中右、上、下三侧通过，左侧一步模型在原图外约 6 像素处画出色块分界，当时未被检出，现已加入平行直线检测，回放全部 14 个已保存的真实扩图步骤，只标出这一步。YOLO 流程图向右扩展时模型画了一张与原图无关的港口照片，被正确标记「需检查」；说明图、表格类图片的空白延伸仍不可靠。去背景 5 例（光学平台、核壳颗粒、肺泡剖面、荧光细胞、线稿移液器）主体完整、背景去净；玻璃、半透明外壳几乎被输出为不透明，透明质感没有保留。

新能力实测（2026-11-19）：共 8 张真实付费图片，无自动重试。透明背景生图 2 张（等轴测磁力搅拌器、线稿显微镜图标），主体外 70% 和 90% 的像素完全透明，边缘干净。局部重绘 2 张：光学平台空白处按描述画出带刻度的量筒，风格一致；风机图右上角画出三只海鸥。两例框外改变像素均为 0。注意框选范围会被完整重绘，海鸥一例的框覆盖了功率曲线图，曲线上因此画了鸟，框选时应避开不想改动的内容。分图层框选 1 例：框住左侧叶片区域、最多 6 张，返回底图和 3 个图层（风向箭头、叶片局部、组件卡片），都落在或贴近框选范围；只测了这一例，没有做不框选的对照。

多参考图与连续编辑实测（2026-11-19）：共 2 张真实付费图片，无自动重试。两张参考图（光学平台、透明背景生成的磁力搅拌器）合成一次：搅拌器按要求放到平台左下角、和量筒并排，平台、标注和原有器件保持不变，但“Lens”标注在结果里缺失，所以合成后需要核对文字。在已重绘的平台图上把量筒液体改成淡绿色（不透明输出）：液体按要求变色，其余内容一致。回看上一轮局部重绘，量筒的阴影超出框线后被还原截断，原有检查没有发现，现已加入框外改动检测；回放两例，只标出这一例。

## English records

Validation includes synthetic pixel tests, mocked UI requests, cached decomposition assets and the public [Volcengine OCR sample](https://docs.volcengine.com/docs/ark/seedream-5-5?lang=zh). Real API checks on 2026-11-14 used three initial images and four further candidate images, without automatic retries: the turbine cutout improved; the erase transition was checked by locally recomposing the cached result; the complex rainforest infographic still did not pass visual outpainting review. PSD text editing, saving and reopening were checked in Photopea; Photoshop itself has not been tested. See [README_CN.md](README_CN.md) for the full guide and shortcuts.

The 2026-11-14/15 outpainting follow-up used three additional real outputs with no automatic retries: both full-image variants failed visual review; the single-sided rainforest left expansion passed whole-image and three magnified boundary inspections, with zero changed original pixels. Other sides have synthetic pixel and simulated interaction checks only. A preceding desktop erase check used one further real output and saved a mixed Chinese/English title, PNG and editable PSD.

On 2026-11-18, one real decomposition request with OCR enabled and a 16-image limit returned 13 images, including seven usable OCR layers. All files and the original were retained, with no automatic retries. The installed-host browser flow verified all seven conversions, Chinese/English edits, original comparison/restoration, undo/redo, layer movement and stacking, full-page reload, and PNG plus both PSD export modes. Independent PSD parsing retained all 13 top-level objects and 13 editable text records. Model stacking required a manual correction, and large decorative titles remained raster layers without OCR. Five earlier real examples (125 layers) also passed local response/asset replay; this was not a new API test. The new PSD files were independently recomposited, but Photopea was unreachable for a fresh external-editor check; the prior Photopea result does not certify these new files or Photoshop compatibility.

The scientific toolbox/style iteration on 2026-11-18 was checked with automated tests, mocked generation requests and an isolated real-host browser: style persistence and request forwarding, local import, confirmation steps, native draft appending and narrow layouts. It added no billed model calls; generation quality for the six styles and sketch entry point has not yet been individually validated.

Local diagram validation (2026-11-18): eight templates created and exported in an isolated native host without an Ark key, with no paid calls. Checked mixed-language node edits, dragging and connection updates, undo/redo, persistence and reload, light/dark themes, and 320/420/768 px widths. All 138 tests passed. Browser-rerendered SVGs were compared with PNGs; two PSDs passed independent parsing and layer recomposition with 9 and 7 editable text records. These templates have not been tested in Photoshop.

Finishing acceptance (2026-11-19): four real paid images, no automatic retries. A chained right/top/bottom expansion of the rainforest image (256 px each, three passes) produced 1920×3008 with zero changed pixels in the original area and no visible rectangular seams in five magnified checks. Enhancing a 640×960 copy produced 1755×2634; foliage and headings were sharper than bicubic, but four small words were rewritten; drift restoration refilled about 13% of the image from the source, which corrected all four at the cost of local softness. PDFs open in poppler and macOS Quartz with the embedded image pixel-identical to the source. Photoshop is not installed on the test machine; two exported PSDs imported into Adobe Illustrator 2025 with all 13 and 9 text records as editable text, and psd-tools re-compositing matched the embedded preview. Fonts are not embedded.

Release checks (2026-11-19, clean clone of `2278669`): typecheck, build and 162 tests pass on Node 22.23.5 and 24.5.0; `prepublishOnly` passes; the native page compatibility test passes against Harness 0.2.2-rc.5. The 1.8 MB package contains only `lib`, `assets` and documentation, with no fixtures, local paths or credentials. Not yet published to npm.

Expansion and cutout batch (2026-11-19): 15 real paid images across six figure types, no automatic retries. Six expansions (ten passes) kept zero changed original pixels. Turbine top, blood-brain-barrier bottom, fluorescent cell left and line-icon pipette left/right joined cleanly; the optical bench passed on three of four sides, but its left pass drew a panel edge about 6 px outside the original that went undetected, so a parallel-line check was added; replayed over all 14 saved real passes, it flags only that pass. Extending the YOLO diagram to the right produced an unrelated harbour photo, which was correctly flagged for review: blank areas beside diagrams and tables remain unreliable. Five cutouts kept complete subjects with clean backgrounds, but glass and translucent shells came back nearly opaque.

New capabilities (2026-11-19): the composer has a **透明背景** toggle for native transparent PNG generation; 拆分图层 lets you box regions, sent as normalized `<bbox>` tags; OCR fonts follow the full 228-font Ark list with category fallbacks for display and PostScript names for PSD. Real tests used 8 paid images, no automatic retries: two transparent generations were 70% and 90% fully transparent with clean edges; two inpaints drew the requested object with zero pixels changed outside the boxes (the whole box is redrawn, so boxes should avoid content to keep); one boxed decomposition returned three layers, all within or touching the box, with no unboxed control run.

Multi-reference and repeated-edit checks (2026-11-19): two real paid images, no automatic retries. Combining two references placed the stirrer beside the cylinder as asked and kept the bench intact, but dropped the "Lens" label, so check text after combining. An opaque repeat edit recoloured the cylinder liquid and left the rest unchanged. Reviewing the earlier inpaint, the cylinder shadow crossed the box and was cut off on restore without a warning; an outside-change check now flags it, and replaying both saved inpaints flags only that one.

发布前检查（2026-11-19，`0.1.0-beta.1`，提交 `c3a4728` 的干净克隆）：Node 22.23.5 与 24.5.0 下 `prepublishOnly`（清理、类型检查、构建、163 项测试）通过；Harness 0.2.2-rc.5 原生页面兼容测试 2 项通过；隔离宿主界面检查（透明背景开关、分图层框选、局部重绘标签）通过，付费调用 0。发布包 `dsh-seedream-0.1.0-beta.1.tgz` 1.8 MB、96 个文件，只含 `lib`、`assets`、`cordis.patch.yml` 与说明文件，未发现本机路径或凭据。尚未发布到 npm。

重新生成、批量生成与测试连接实测（2026-11-20）：共 3 张真实付费图片，无自动重试。测试连接用真实 Key 返回“连接正常”，未生成图片；伪造 Key 返回 401 AuthenticationError。批量生成两项（有丝分裂中期、后期，扁平风格，1K）都成功，报告“成功 2 / 共 2”。对中期图重新生成一次：新图在原位置，记录为同一组版本，旧图隐藏但保留，提示词使用用户原文。发现：同一批次即使指定同一风格，两张图的配色、外形和线条仍明显不同，批量生成不能保证风格统一；后期图中染色体仍画成 X 形，科学上不准确，属于模型内容问题。界面截图在隔离宿主中拍摄，付费调用 0。
