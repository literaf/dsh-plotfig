# Third-party notices / 第三方声明

The AGPL license for AI4Scholar-authored code does not replace the licenses of third-party software. Commercial agreements with AI4Scholar cover only rights AI4Scholar owns. Preserve the applicable upstream notices when redistributing these components.

This inventory identifies direct runtime dependencies, the actual third-party inputs in the browser bundle, and host peer packages used for this release. It is not a complete inventory of every transitive or platform-specific dependency installed by the host. Separately installed packages carry their own licenses and notices, which remain applicable.

AI4Scholar 自有代码采用的 AGPL 不替代第三方许可；另行商业授权也仅覆盖 AI4Scholar 拥有的权利。再分发相关组件时应保留其原始声明。下表包含直接运行时依赖、实际打入浏览器包的组件及宿主 peer 组件；它不是宿主全部传递依赖或各平台原生库的完整清单，独立安装的依赖仍适用各自随包提供的许可。

| Component | Version | License | Use in this package | Notice |
| --- | --- | --- | --- | --- |
| `@deepseek-ai/cordis` | 4.0.2 | `MIT` | host peer dependency; not bundled | [LICENSE](LICENSES/third-party/deepseek-ai__cordis__LICENSE.txt) |
| `@deepseek-ai/dsh-commands` | 0.1.1-rc.2 | `MIT` | host peer dependency; not bundled | [LICENSE](LICENSES/third-party/deepseek-ai__dsh-commands__LICENSE.txt) |
| `@deepseek-ai/dsh-credentials` | 0.1.1-rc.2 | `MIT` | host peer dependency; not bundled | [LICENSE](LICENSES/third-party/deepseek-ai__dsh-credentials__LICENSE.txt) |
| `@deepseek-ai/dsh-llm` | 0.1.1-rc.2 | `MIT` | host peer dependency; not bundled | [LICENSE](LICENSES/third-party/deepseek-ai__dsh-llm__LICENSE.txt) |
| `@deepseek-ai/dsh-system-prompt` | 0.1.1-rc.2 | `MIT` | host peer dependency; not bundled | [LICENSE](LICENSES/third-party/deepseek-ai__dsh-system-prompt__LICENSE.txt) |
| `@deepseek-ai/dsh-tools` | 0.1.1-rc.2 | `MIT` | host peer dependency; not bundled | [LICENSE](LICENSES/third-party/deepseek-ai__dsh-tools__LICENSE.txt) |
| `@deepseek-ai/schemastery` | 3.18.5 | `MIT` | host peer dependency; not bundled | [LICENSE](LICENSES/third-party/deepseek-ai__schemastery__LICENSE.txt) |
| `@napi-rs/image` | 1.16.0 | `MIT` | installed runtime dependency | [LICENSE](LICENSES/third-party/napi-rs__image__LICENSE.txt) |
| `ag-psd` | 34.2.0 | `MIT` | bundled browser component | [LICENSE](LICENSES/third-party/ag-psd__LICENSE.txt) |
| `base64-js` | 1.5.1 | `MIT` | bundled browser component | [LICENSE](LICENSES/third-party/base64-js__LICENSE.txt) |
| `image-size` | 2.1.0 | `MIT` | installed runtime dependency | [LICENSE](LICENSES/third-party/image-size__LICENSE.txt) |
| `its-fine` | 1.2.5 | `MIT` | bundled browser component | [LICENSE](LICENSES/third-party/its-fine__LICENSE.txt) |
| `jpeg-js` | 0.4.4 | `BSD-3-Clause` | installed runtime dependency | [LICENSE](LICENSES/third-party/jpeg-js__LICENSE.txt) |
| `konva` | 10.9.1 | `MIT` | bundled browser component | [LICENSE](LICENSES/third-party/konva__LICENSE.txt) |
| `pako` | 2.1.0 | `(MIT AND Zlib)` | bundled browser component | [LICENSE](LICENSES/third-party/pako__LICENSE.txt) |
| `pngjs` | 7.0.0 | `MIT` | installed runtime dependency | [LICENSE](LICENSES/third-party/pngjs__LICENSE.txt) |
| `react` | 18.3.1 | `MIT` | host peer dependency; not bundled | [LICENSE](LICENSES/third-party/react__LICENSE.txt) |
| `react-konva` | 18.2.16 | `MIT` | bundled browser component | [LICENSE](LICENSES/third-party/react-konva__LICENSE.txt) |
| `react-reconciler` | 0.29.2 | `MIT` | bundled browser component | [LICENSE](LICENSES/third-party/react-reconciler__LICENSE.txt) |
| `scheduler` | 0.23.2 | `MIT` | bundled browser component | [LICENSE](LICENSES/third-party/scheduler__LICENSE.txt) |

The DeepSeek Harness module wrapper and host-integration interfaces follow the upstream Harness integration model; applicable upstream MIT notices are retained with the host component notices above. Build-time tooling not shipped in the plugin retains its own upstream licenses.

## Separately identified preview assets

[`assets/style-preview-provenance.json`](assets/style-preview-provenance.json) records the preview sources and individual terms. Bioicons references identified there as CC0 retain CC0; other preview metadata, including AI-generated samples, is preserved as recorded. The software license does not relabel these assets or grant rights the project does not own.

预览素材的来源及逐项许可见上述 provenance 文件。标注 CC0 的 Bioicons 参考素材继续适用 CC0；AI 生成样稿等其他素材的已有来源说明保留。本次软件换证不重写素材许可，也不授予项目未拥有的权利。
