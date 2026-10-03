/** 保护技改项目立项与费用结算台账——领域类型。 */

// 状态只能按 立项 → 评审 → 实施 → 结算 依次流转，序号即合法次序。
export const PROJECT_STATUSES = ['立项', '评审', '实施', '结算'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

/** 费用结算条目：发票号、结算日期是硬性必填，缺一格都挡回。 */
export type ExpenseItem = {
  id: number
  /** 费用摘要，如“保护装置采购费” */
  title: string
  /** 金额（分），内部一律整数，避免 0.1 + 0.2 的浮点问题 */
  amountCents: number
  /** 发票号：同一项目内不允许重复，重复提交只算一次 */
  invoiceNo: string
  /** 结算日期（YYYY-MM-DD） */
  settledAt: string
  /** 当前办理人，回答“卡在谁那里” */
  handler: string
  createdAt: string
}

export type ProjectLog = {
  at: string
  message: string
}

export type RenovationProject = {
  id: number
  /** 项目编号，唯一 */
  code: string
  name: string
  substation: string
  ownerDept: string
  manager: string
  status: ProjectStatus
  /** 批复的立项预算（分）——预算冲突时永远以它为准 */
  approvedBudgetCents: number
  /** 结算单填的预算（分），仅作留痕；展示与剩余额度都以立项预算为准 */
  settlementBudgetCents: number | null
  /** 结算单编号，完成结算时生成 */
  settlementNo: string
  settledAt: string
  expenses: ExpenseItem[]
  /** 已同步到主变检修待排期清单后，回写生成的检修编号 */
  maintenanceRef: string
  logs: ProjectLog[]
  createdAt: string
}

/** 主变检修待排期清单中的联动条目。 */
export type MaintenanceScheduleItem = {
  id: number
  maintenanceNo: string
  sourceProjectId: number
  sourceProjectCode: string
  substation: string
  mainTransformer: string
  category: string
  outageScope: string
  budgetCents: number
  settledAt: string
  createdAt: string
}

export type LedgerState = {
  projects: RenovationProject[]
  maintenanceSchedule: MaintenanceScheduleItem[]
  seqProject: number
  seqExpense: number
  seqMaintenance: number
}

export type ActionResult<T = undefined> = {
  ok: boolean
  message: string
  /** 挡回时逐格说明缺什么/错什么，便于页面标红对应输入框 */
  fields?: string[]
  data?: T
}
