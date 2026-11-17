# awesome-dsh-plugin 条目（复制到 PR 里）

把这个文件的内容作为 **一个** 新文件提交到
<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>：

```
data/plugins/flying-silk-sky__dsh-screenshot-plugin.yml
```

已按 GitHub 账号 `flying-silk-sky` 填好。仓库名若不叫 `dsh-screenshot-plugin`，把文件名和下面 YAML 里的仓库名一起改；文件名用双下划线连接 owner 和 repo。

规则来源：<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md>

```yaml
url: https://github.com/flying-silk-sky/dsh-screenshot-plugin   # 必须与仓库地址完全一致
name: flying-silk-sky/dsh-screenshot-plugin                     # 列表里显示的链接文字
category: ui                                                    # 输入框工具栏控件，属于界面增强
description:
  en: Adds a camera control to the composer that captures the screen — optionally hiding the DSH window first — and attaches a cropped region to the draft on Windows.
  zh: 在输入框工具栏加一个截图按钮：可先隐藏 DSH 窗口再截屏，框选区域后作为图片附件放进草稿（仅 Windows）。
```

## 可选项

**图标**（GitHub 托管的位图，png/jpg/jpeg/webp，卡片约 96px，推荐方形）：

```yaml
icon: https://raw.githubusercontent.com/flying-silk-sky/dsh-screenshot-plugin/main/assets/icon-180.png
```

**预构建 tarball**（不发 npm 时才需要；必须是 GitHub Release 的 https `.tgz`，资产名不要带版本号）：

```yaml
tarball: https://github.com/flying-silk-sky/dsh-screenshot-plugin/releases/latest/download/dsh-screenshot-plugin.tgz
```

**截图**（不放在条目里，而是放你自己仓库的 `screenshots.json`，1–8 张）：

```jsonc
// <repo>/screenshots.json
[
  "assets/screenshot-1.png",
  "assets/screenshot-2.png"
]
```

## CI 会检查的东西（对照本仓库）

- `package.json` 里有 `dsh.bundle.patch` ✅（只有 `dsh.client` 会被拒）
- 仓库根有 `cordis.patch.yml` ✅
- 仓库创建满 1 天、加了 `dsh-plugin` topic、有真实代码
- 描述属实、不夸大；分类贴切
- 一个 PR 最多 3 条
