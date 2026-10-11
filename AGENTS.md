# 项目维护约定

- 本对话的项目修改默认位于本目录 `bangumi`。
- 用户要求：后续修改时同步更新 `CHANGELOG.md`，记录新增功能、改进和 bug 修复。
- 未发布的修改记入「未发布」；生成新版本 APK 时，将对应条目归入实际版本号，并核对 `package.json`、`package-lock.json` 与 Android 的 `versionName` / `versionCode`。
- 历史版本、日期和功能归属必须有依据，不补造缺失的记录。
- 仅修改文档不要求升级应用版本或生成 APK，但仍须更新变更日志。
