# dsh-screenshot-plugin

像豆包那样的「截图提问」控件：点一下相机图标，直接截取屏幕并框选区域，截图会作为图片附件进入输入框，接着打字提问即可。

## 功能

- **隐藏界面截图**：先把当前 DSH 窗口隐藏，截取它背后的桌面，截完立即把窗口恢复成原来的状态（原来最大化的还是最大化，原来最小化的还是最小化）。
- **显示界面截图**：窗口保持可见，直接截取当前屏幕。
- 截完弹出**冻结的全屏选择层**：拖动框选，`Enter` 确认，`Esc` 取消，也可以点「整屏」。
- 选中的区域裁剪成 PNG，作为图片附件加入当前会话的输入框，并自动聚焦输入框。
- 中英文界面跟随 DSH 当前语言。

原理：浏览器页面里没有任何截屏权限问题——截图由宿主进程用 PowerShell + `System.Drawing.CopyFromScreen` 完成（物理像素、支持多显示器拼接出的虚拟桌面、按 DPI 感知），图片通过插件自己的本地 HTTP 路由回传给页面。

## 安装

插件已经装进 `web` profile（`link:` 本地链接方式）：

```powershell
dsh plugin --profile web add "link:C:/Users/SF/Documents/deepseek-harness/default-workspace/dsh-screenshot-plugin"
```

装完刷新页面（F5）即可。重新安装/卸载：

```powershell
dsh plugin --profile web remove dsh-screenshot-plugin
```

装到别的机器上（先按下面「发布到插件市场」把仓库公开）：

```powershell
# 从 GitHub 直接装（仓库根有 package.json + cordis.patch.yml 即可；预构建产物已入库，无需构建）
dsh plugin --profile web add "git+https://github.com/flying-silk-sky/dsh-screenshot-plugin.git"

# 或者发布了 npm 包之后
dsh plugin --profile web add dsh-screenshot-plugin
```

## 使用

1. 输入框左侧工具行最右边（`+` 附件按钮旁边）点相机图标。
2. 选「隐藏界面截图」或「显示界面截图」。
3. 拖动框选区域，`Enter` 或「完成」。
4. 截图出现在输入框的附件里，直接输入问题发送。

## 宿主路由

| 方法与路径 | 说明 |
| --- | --- |
| `POST /dsh-screenshot/capture` | 请求体 `{"mode":"hide"\|"show","title":"<document.title>"}`，返回 `{"ok":true,"image":"data:image/png;base64,…","width","height","origin","hidden","reason"}` |
| `GET /dsh-screenshot/health` | 环境自检：平台、可用的 PowerShell 可执行文件、脚本是否存在、是否正在截图 |

两个路由都走 DSH 的连接鉴权（`ctx.connection.requestRejection`），非法来源直接 401/403；同一时刻只允许一次截图，第二次请求返回 409。

`reason` 说明窗口是怎么找到的：`foreground`（前台窗口标题命中）、`title`（枚举窗口标题命中）、`foreground-fallback`（没命中，退回前台窗口）、`not-found`（没找到窗口，此时不隐藏任何窗口）。

## 配置

- 环境变量 `DSH_SCREENSHOT_PWSH`：指定 PowerShell 可执行文件路径，优先级最高；否则依次尝试 `pwsh.exe`、`powershell.exe`。
- 截图超时 30 秒；请求体上限 8 KB；标题长度上限 300 字符。

## 限制

- 仅 Windows（依赖 `System.Drawing` 与 Win32 窗口 API）。
- 「隐藏界面截图」隐藏的是 DSH 所在的浏览器窗口：如果浏览器被最小化，会按原状态恢复；如果 DSH 窗口不是前台窗口，会退回前台窗口作为目标（此时截图里可能包含别的窗口）。
- 截到的是整个物理桌面，多显示器时是虚拟桌面整体；框选坐标按 `naturalWidth / 显示宽度` 换算，所以高 DPI 下裁出来的仍是原始物理像素。
- 图片只在本机内存和本地 HTTP 路由之间流转，不落盘到插件目录（宿主用系统临时目录中转，用完即删）。

## 发布到插件市场

DSH 的插件市场（`dshmarket` 的 Discover 页 / 插件页）没有「上传」入口，它读的是精选列表 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 生成的注册表（`https://awesome-dsh-plugin.com/plugins.json`）。所以上架只有两件事：**一个公开的 GitHub 仓库** + **一个往那个列表加条目的 PR**。

1. 建 GitHub 仓库，把本目录整个推上去。仓库根就是本目录：`package.json` 里有 `dsh.bundle.patch`，旁边有 `cordis.patch.yml`，`lib/client.js` 是预构建产物、直接提交即可（安装时不需要构建，也就不需要 `allowBuilds` 授权）。`.install-backup/` 是本机 profile 的备份，已在 `.gitignore` 里排除。
2. 给仓库加 topic `dsh-plugin`；仓库要创建满 1 天（CI 自动检查）。
3. 按 [`docs/market-entry.md`](docs/market-entry.md) 的内容，往 awesome-dsh-plugin 提一个 PR，新增 `data/plugins/flying-silk-sky__dsh-screenshot-plugin.yml`（一个 PR 最多 3 条；不要手工改两个 README，它们是生成的）。
4. 合并后站点和市场通常在一天内自动收录。**不要**往 `dshmarket` 仓库提插件条目——那个仓库是市场应用本身。
5. 可选：发布到 npm，市场就能显示下载量。已发布包的 `repository` 字段必须指回第 1 步的仓库，否则两者不关联；条目里不要手写 `npm:` 字段（校验会拒）。

CI 检查的四项：`dsh.bundle` manifest、仓库年龄、`awesome-lint`/站点构建、以及「描述是否与代码一致」。所以描述里只写确实做到的事（本插件的隐藏窗口截图、框选、附件注入、仅 Windows）。

## 文件

- `package.json`：宿主半（`lib/index.js`）＋ 浏览器半（`lib/client.js`）＋ `dsh.bundle.patch`。
- `cordis.patch.yml`：作为 profile 层插入 `ui-screenshot` 条目。
- `lib/index.js`：路由、鉴权、临时目录、子进程与结果解析。
- `lib/capture.ps1`：DPI 感知、按标题找窗口、隐藏/恢复、`CopyFromScreen` 截全屏 PNG。
- `lib/client.js`：手写的懒加载 CJS bundle（`window.__ModuleLoader__.load`），注册 `conversation.input.left` 槽位控件、菜单、框选层、裁剪与附件注入。
- `test/host-test.mjs`：不起服务器直接驱动两条路由的脚本。
- `test/client-smoke.mjs`：用桩模块模拟 `__ModuleLoader__`，验证 bundle 能加载、注册槽位并渲染。
