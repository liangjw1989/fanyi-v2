# 第三方组件声明（NOTICE）

灵译 LingYi 自身代码的许可见 [LICENSE](LICENSE)。
下图这些**第三方开源库由本软件在运行时从 CDN 加载**（也可放入 `vendor/` 目录离线使用），
它们的版权归各自作者所有，遵循各自的许可证，**不受本项目 LICENSE 约束**。

| 组件 | 用途 | 许可证 | 版权 |
|---|---|---|---|
| [pdf.js](https://mozilla.github.io/pdf.js/) 3.11.174 | 解析 PDF 文字与坐标 | Apache-2.0 | © Mozilla Foundation |
| [mammoth.js](https://github.com/mwilliamson/mammoth.js) 1.6.0 | 解析 Word(.docx) 结构 | BSD-2-Clause | © Michael Williamson |
| [docx](https://github.com/dolanmiu/docx) 8.5.0 | 生成 Word 文档 | MIT | © Dolan Miu |
| [tesseract.js](https://github.com/naptha/tesseract.js) 5.x | 图片文字识别（OCR） | Apache-2.0 | © Naptha AI |
| [marked](https://github.com/markedjs/marked) | Markdown 解析 | MIT | © Christopher Jeffrey 等 |
| [qrcodejs](https://github.com/davidshimjs/qrcodejs) 1.0.0 | 生成二维码 | MIT | © davidshimjs |
| [Font Awesome](https://fontawesome.com/) 6.x（CSS） | 图标 | CC BY 4.0 / MIT（Free 版） | © Fonticons, Inc. |
| [Inter](https://rsms.me/inter/)（字体，CSS） | 界面字体 | SIL OFL 1.1 | © Rasmus Andersson |

## 关于字体

`vfs_fonts.js` / `思源vfs_fonts.js` 为早期 pdfmake 方案使用的中文字体打包文件，
**当前版本不再引用**，已在 `.gitignore` 中排除，不随本仓库分发。

若你确实需要随程序分发字体，请自行确认其许可证：
思源宋体 / Noto Serif CJK 采用 SIL Open Font License 1.1（允许随软件分发，但需保留其许可文件）。

## 关于翻译服务

本软件**不内置**任何翻译模型，翻译由使用者配置的第三方服务完成：

- 腾讯云机器翻译（TMT）——受腾讯云服务条款约束
- DeepSeek API——受 DeepSeek 服务条款约束

本项目与上述服务商无从属关系；接口密钥由部署者自行配置与保管。
