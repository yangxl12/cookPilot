# CookPilot

手机端 AI 烹饪助手。此目录用于正式开发，原型工程已集中归档。

正式开发以以下两项为依据：

- [CookPilot 最终开发说明](./docs/CookPilot最终开发说明.md)：业务规则、首版范围、数据约束与验收标准；与历史文档冲突时，以此文档为准。
- [demo.html](./demo.html)：页面布局与交互基准，可直接用浏览器打开。模型相关能力为模拟，正式版需要接入真实模型。

## 目录

```text
CookPilot/
├─ docs/
│  ├─ CookPilot最终开发说明.md   正式开发说明
│  └─ 中外经典家常菜200道.md     预置菜谱内容资料
├─ demo.html                   固定保留的 UI / 交互参考
├─ archive/
│  └─ demo/                    原 Demo 工程及历史资料
│     ├─ src/                  React / TypeScript 原型源码
│     ├─ public/               图片、字体及字体许可
│     ├─ scripts/              单文件 Demo 打包脚本
│     ├─ tests/                原型浏览器测试
│     ├─ docs/                 历史页面与烹饪指南说明
│     ├─ README.md             原 Demo 使用说明
│     ├─ REQUIREMENTS.md       历史需求文档
│     ├─ DEMO_ANALYSIS.md      历史实现分析
│     └─ …                     工程配置、依赖与本地产物
└─ README.md
```

正式应用代码可在根目录建立；当前根目录尚未初始化正式应用工程。归档中的模拟逻辑与旧数据结构仅供参考，具体实现遵循最终开发说明。

## 运行归档 Demo

在项目根目录执行：

```powershell
cd archive/demo
npm ci              # 首次使用或需要重装依赖时执行
npm run dev
```

在 `archive/demo/` 内执行 `npm run build` 可检查 TypeScript、构建 `dist/` 并生成该目录下的 `demo.html`；执行 `npm test` 可运行原浏览器测试（使用本机 Google Chrome）。构建产物不会覆盖根目录作为正式开发依据的 `demo.html`。

原有未提交修改、依赖、构建产物、测试结果以及 `.local/` 中的截图和辅助脚本均随工程保留在归档目录。依赖和临时产物继续由 Git 忽略。
