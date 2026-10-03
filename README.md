# 变电站继电保护定值整定与二次设备检修管理平台

面向变电站台账、保护装置、定值整定与核对、二次回路检查、保护校验、故障录波分析、主变检修与直流系统监测的一体化电网二次设备运维管理工作台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 变电站台账 | `substation` | 变电站 | 站名、电压等级、所属供电所 |
| 保护装置台账 | `protectiondevice` | 保护装置 | 装置编号、所属间隔、装置型号 |
| 定值整定 | `settingvalue` | 定值单 | 定值单号、所属装置、定值项目 |
| 定值核对 | `settingcheck` | 核对记录 | 核对编号、所属变电站、装置名称 |
| 二次回路检查 | `secondarycircuit` | 回路检查记录 | 检查编号、所属间隔、回路类别 |
| 保护校验 | `relaytest` | 校验记录 | 校验编号、装置名称、校验项目 |
| 故障录波 | `faultrecord` | 录波记录 | 录波编号、故障线路、故障类型 |
| 保护动作统计 | `tripstat` | 动作统计 | 统计编号、所属线路、动作次数 |
| 主变检修 | `transformermaint` | 主变检修记录 | 检修编号、主变名称、检修类别 |
| 断路器维护 | `breaker` | 断路器 | 设备编号、所属间隔、断路器型号 |
| 直流系统监测 | `dcsystem` | 直流监测记录 | 监测编号、所属变电站、蓄电池组号 |
| 绝缘试验 | `insulationtest` | 试验记录 | 试验编号、试验设备、试验项目 |
| 缺陷处置 | `defect` | 缺陷记录 | 缺陷编号、缺陷设备、缺陷等级 |
| 工作票许可 | `workpermit` | 工作票 | 工作票号、工作任务、所属变电站 |
| 设备巡视 | `patrol` | 巡视记录 | 巡视编号、巡视变电站、巡视路线 |
| 计量装置核查 | `meteringcheck` | 核查记录 | 核查编号、计量点名称、电能表编号 |
| 定值审批 | `settingapprove` | 审批单 | 审批单号、关联定值单、审批层级 |
| 安全工器具检定 | `safetytool` | 安全工器具 | 工器具编号、工器具名称、所属班组 |
| 保护技改立项与费用结算台账 | `renovation` | 保护技改项目 | 项目编号、立项预算、费用发票、结算单（专用强规则模块，见下） |

### 保护技改项目立项与费用结算台账（`renovation`）

该模块有严格的跨部门流程规则，不套用通用模块的「任意动作跳转」，规则全部落在
`src/data/renovation/ledger-service.ts`（纯函数）并用 `npm test` 固化：

- **顺序流转**：状态只能 立项→评审→实施→结算 走相邻一步；跳级、回退一律拒收；
  「实施→结算」必须通过结算单提交。
- **结算锁定**：已结算项目不得回到实施阶段补改费用或预算，结算单与台账只读。
- **费用闸口**：费用仅在实施阶段登记；发票号、结算日期（还包括摘要、金额、办理人）
  缺哪格挡回时逐格说明；同一项目内发票号重复视为同一笔费用，只算一次。
- **预算同步**：台账与结算单两处预算必须一致；冲突时以批复的立项预算为准（挡回结算单，
  绝不覆盖立项预算）。费用累计超过剩余预算同样拒收。
- **主变检修联动**：结算完成后自动向「主变检修待排期清单」推送一条（编号 `ZX-xxxx`），
  同一项目只推一次；页面顶部可切换查看该清单。
- 每条项目都有流转日志，列表里的「当前卡在」取最后一笔费用的办理人（无费用时为项目经理）。

数据保存在浏览器 `substation-protection:renovation-ledger`，页面上「恢复示例数据」可一键还原。

## 测试

```bash
cd frontend
npm test          # 保护技改台账的领域规则测试（Node 内置 test runner，无需额外依赖）
npm run typecheck # vue-tsc 类型检查
```

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `substation-protection:entries` 这一项，或调用 `resetModule(模块)`。
