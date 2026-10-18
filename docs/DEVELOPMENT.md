# 番组口袋开发文档

[返回使用说明](../README.md)

## 技术与目录

界面使用 React、TypeScript 和 Vite，Android 使用 Capacitor 8 封装，前端资源随 APK 打包。项目没有自建业务后端，也不在安装包中内置 API 密钥。

| 位置 | 内容 |
| --- | --- |
| `src/App.tsx`、`src/styles.css` | 页面、交互与手机布局 |
| `src/api.ts`、`src/detail-api.ts` | 作品、章节、角色与关联作品 |
| `src/account-api.ts`、`src/sync.ts` | 账号接口、同步与离线队列 |
| `src/AccountPanel.tsx`、`src/vault.ts` | 授权界面与凭据保存 |
| `src/community-api.ts`、`src/friends-api.ts` | 评论、动态与表情互动 |
| `src/updates.ts`、`src/UpdateManager.tsx` | 更新信息与启动更新策略 |
| `android/` | 原生工程、凭据加密与安装包下载、安装逻辑 |
| `scripts/`、`tests/` | 构建、发布和验证脚本及测试数据 |
| `docs/api-v0.yaml`、`docs/api-private.yaml` | 保存的接口参考，实际行为需核对官方最新资料 |

## 本地运行

需要 Node.js 22 或以上、npm 和 Git。Android 构建还需要 JDK 21、Android SDK Platform 36 与 Build Tools 35 / 36。

```sh
git clone https://github.com/Wepdekr/bangumi-pocket.git
cd bangumi-pocket
npm ci
npm run dev
```

预览地址为 `http://localhost:5173`。开发服务默认监听局域网，便于用同一网络的手机浏览器预览；仅本机使用时可运行 `npm run dev -- --host 127.0.0.1`。

```sh
npm run build
npm run preview
```

网页预览中的授权令牌只保存在内存，刷新后需要重新连接。

## Android 构建

当前配置与构建脚本面向 Windows PowerShell。首次配置可运行以下脚本，将官方 JDK 和 Android SDK 下载到项目的 `.toolchain/`；也可自行设置 `JAVA_HOME` 与 `ANDROID_HOME`。

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-android.ps1
npm run android:build
```

构建脚本会先构建前端、同步 Capacitor 资源，再生成 APK。输出为 `artifacts/bangumi-pocket-debug.apk` 和带版本号的副本。

也可以在 Android Studio 中打开 `android/`。前端修改后，先运行 `npm run android:sync`，再编译原生工程。最低 Android 7.0，界面运行依赖 Android System WebView。

现有公开安装包使用开发调试签名。发布更新必须保留原签名密钥，构建后与上一版 APK 的签名证书比对，确保用户能够覆盖安装。新环境自动生成的调试密钥不能替代原密钥。

## 接口与同步约定

接口参考：[Bangumi API](https://bangumi.github.io/api/)、[新站接口文档](https://bangumi.github.io/dev-docs/)与[公开 API 源码](https://github.com/bangumi/server)。新站接口及实验性搜索接口可能变化，调整前应核对官方实现。

- 普通内容与收藏主要使用 `api.bgm.tv`；Android 使用原生 HTTP 请求。
- 动画与三次元的单集操作使用 `next.bgm.tv/p1/collections/episodes/{episodeID}`，提交 `type`。「看到这里」向 `api.bgm.tv/ep/{episodeID}/status/watched?ep_id=章节ID列表` 发送 POST，查询参数与表单均携带相同 ID，不再让新站按序号自行查询章节。官方历史规范将批量 `ep_id` 定义为 query 参数；只发 form 不能视为等价。
- 旧版接口的 HTTP 状态与业务状态不同，`error` 是状态说明，成功时也可能为 `OK`、`Accepted` 或 `Not Modified`。仅按业务 `code=200/202/304` 确认成功；401 等真实业务失败保留队列，缺失或畸形响应显示结果未确认，不伪造服务器 500。规范依据：[官方历史 OpenAPI](https://github.com/bangumi/api/blob/8da01e33f371030dd1e16222dbec7c59a5282daf/open-api/api.yml)。
- 离线章节操作按顺序持久化，成功后逐项确认；旧版待同步章节记录中已保存的 ID 列表继续使用。批量接口失败时不改用其他写入方式，保留操作等待重试。
- 收藏状态与评分、短评在同一请求中提交，确保收藏动态包含评价。仅编辑评价时也携带当前收藏状态。
- 拉取账号收藏使用 `/v0/me` 返回的 `username`。完整拉取成功后才替换本机缓存，避免中途失败导致片单缺失。
- 本机与账号片单分开保存，待同步修改按账号隔离。导入采用追加合并，保留账号中已有的收藏状态、评价、标签与私密设置。
- 内容请求失败时可使用 15 分钟内的缓存；账号写入和好友动态不进入公共缓存。

### 评论与动态

评论通过新站匿名接口读取 `/p1/subjects/{id}/comments` 和 `/reviews`，长评全文打开原站。

好友动态先读取 `/p1/friendlist` 验证授权并确定好友范围，再读取 `/p1/timeline?mode=friends`，按好友与当前用户 ID 筛选。没有好友时读取用户自己的时间线，避免接口回退为全站动态。退出或切换账号时清除当前动态，动态不持久化。

首次读取与刷新时同时核对本人的原站公开时间线，补充新站索引遗漏的记录，按动态 ID 去重和排序；不修改原站动态。公开页面请求不携带令牌或 Cookie，HTML 在独立文档中解析，仅以文本和受限的作品链接、封面显示，不插入远程 HTML。补充读取失败时保留接口结果并提示用户，分页仍沿用接口游标。

来源名称不参与动态筛选。对于本人同一 ID 的收藏或进度动态，以原站当前公开内容更新显示，同时保留接口返回的互动对象 ID 和表情数据，避免服务端合并记录后仍显示旧内容。`API` 与 `next` 来源均使用相同读取规则；来源名称由服务端决定，客户端不伪造来源或重复写入动态来统一名称。

个人时间线通过 `/p1/users/{username}/timeline` 读取，严格核对返回的用户 ID，按 `until` 分页；首屏同样核对目标用户的原站公开时间线。页面复用动态卡片与互动逻辑，使用应用内历史记录处理返回，并在进入作品详情时保留时间线页面及滚动位置；退出或切换账号后清除对应的时间线路由和数据。

新站 `batch: true` 查询按正篇类型和章节序号筛选，未过滤被封禁章节；原站页面的“看到”则提交实际显示的章节 ID。两种写入方式不等价，不能把新站批量接口视为原站行为的直接替代。客户端批量操作先获取完整正篇列表，再提交明确 ID，并保留后续已看进度；重复“看到这里”仍允许提交，全部正篇已完成且当前状态不是看过时进入完成评价流程，确认后同步看过及评价。遇到已有异常历史计数时仅提示异常，不虚构历史数字。

表情沿用官方资源和编号：吐槽使用 `/p1/timeline/{id}/like`，带短评的单条收藏动态使用 `/p1/subjects/-/collects/{collectID}/like`。服务端确认后才更新已选状态与人数，总人数按用户 ID 去重。没有对应接口的动态不显示发表情按钮。

Vite 开发与预览通过同源代理访问新站；评论代理移除 Cookie 和授权头，账号与动态代理移除 Cookie、保留 Bearer 授权。Windows 自动读取系统网络代理，也可用 `BANGUMI_HTTP_PROXY` 配置开发代理；这不会修改系统代理设置。

### 授权与显示

Android 令牌使用 Android Keystore 生成的 AES-GCM 密钥加密保存，关闭应用自动备份与 Capacitor 调试日志。网页预览令牌只驻留内存。源码、日志和测试数据中不得包含个人令牌、签名密钥或本机配置。

当前账号连接使用个人访问令牌。尚未配置 OAuth 应用、回调及授权交换服务，不把 `client_secret` 放入 APK。[官方认证说明](https://github.com/bangumi/api/blob/master/docs-raw/How-to-Auth.md)

纯文本显示统一解码一次 HTML 实体，不递归解码、不解析 HTML 标签，也不改写原始数据、缓存、URL、账号标识或评价输入。旧封面地址在显示时升级为 HTTPS。

章节放送状态根据标注日期与设备本地日期判断，当天视为已到放送日，不推测具体播出时间；放送标记与个人观看状态合并在原勾选按钮中。

## 验证

单元测试及构建可独立执行：

```sh
npm run test:sync
npm run test:timeline
npm run build
```

浏览器测试先启动 `npm run dev`，再按改动选择相关检查：

```sh
npm test
npm run test:detail
npm run test:library
npm run test:air
npm run test:text
npm run test:updates
npm run test:startup-updates
npm run test:update-download
node scripts/test-account-ui.mjs
node scripts/test-comments.mjs
node scripts/test-friends.mjs
```

测试使用 Playwright；部分脚本默认调用已安装的 Chrome，部分使用 Edge 或支持 `PLAYWRIGHT_CHANNEL`，以各脚本为准。截图与测试产物保存在 `artifacts/`。

账号测试使用模拟响应，覆盖请求格式、原生传输参数、离线与重启、账号隔离、部分成功重试、评价保留、动态筛选与表情互动。`node scripts/smoke-live.mjs` 可验证实时内容 API 与封面加载。

模拟测试不等于生产账号写入验证。真实授权、私密收藏、系统安装权限及 Android 凭据持久化等，需要在合适的测试环境中验证，报告结果时说明验证范围。

## 版本与发布

功能新增、体验改进与 Bug 修复写入 [CHANGELOG.md](../CHANGELOG.md)。未发布的应用改动先记入「未发布」，发布时归入实际版本。日志与更新弹窗按功能和问题类型概括，每项通常一到两句；仅问题确实局限于某处时才点名具体位置。

**纯文档变更不写入 CHANGELOG，不升级应用版本，也不生成 APK。** 文档随功能修改时，日志只记录功能或修复本身。

发布 APK 前：

1. 核对 `package.json`、`package-lock.json`、Android `versionName` 与请求的 User-Agent 中的版本，递增 `versionCode`。
2. 完成相关验证，确认 APK 的包名、版本、原签名和内容一致。
3. 将版本说明归入对应日志条目，提交并推送源码至 `origin/main`。
4. 安装并授权官方 GitHub CLI，运行发布脚本。

```powershell
npm run android:release
```

脚本构建并校验 APK，生成 SHA256 文件与 `update.json`，将对应版本日志作为说明，先上传草稿、核实附件后再公开发布。已发布版本禁止覆盖附件，修复后使用新版本号。

已有验证通过的 APK 时，可以跳过重建。以下命令中的 `版本号` 需替换为当前实际版本：

```powershell
npm run android:release -- -ExistingApk artifacts/bangumi-pocket-版本号-debug.apk

# 仅在本地校验并生成发布材料，不上传
npm run android:release -- -ExistingApk artifacts/bangumi-pocket-版本号-debug.apk -ValidateOnly
```

发布脚本要求工作区干净，即使仅校验也需先提交源码。发布后核验公开 APK、SHA256 文件和最新 `update.json` 均可下载，且版本、大小、下载地址及哈希对应同一安装包。

### 应用更新策略

更新信息读取 GitHub 最新正式 Release 的 `update.json`，不依赖 GitHub REST API 的匿名配额。版本按 `major.minor.patch` 比较：启动时无更新或仅补丁更新不提示，次版本更新可选，主版本更新需安装后继续使用；手动检查可发现所有新版本。已确认的强制更新要求跨重启保留。

原生下载支持后台执行、取消、重试与进度显示。完成后校验文件完整性、包名、版本和签名，再打开系统安装器；缺少安装权限时引导授权后继续。
