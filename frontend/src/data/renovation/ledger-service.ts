/**
 * 保护技改台账的业务规则核心：纯函数，不碰 localStorage / DOM，方便单测。
 * 所有写操作都返回新 state（配合 saveLedger 持久化），校验失败返回带 fields 的结果。
 */
import {
  PROJECT_STATUSES,
  type ActionResult,
  type ExpenseItem,
  type LedgerState,
  type ProjectStatus,
  type RenovationProject,
} from './types'

export const todayText = (): string => new Date().toISOString().slice(0, 10)

/** “元”字符串转“分”整数：支持 12、12.3、12.34；非法返回 null。 */
export function yuanToCents(raw: string | number): number | null {
  const text = String(raw).trim().replace(/[，,¥￥\s]/g, '')
  if (text === '' || !/^\d+(\.\d{1,2})?$/.test(text)) {
    return null
  }
  const [intPart, decimal = ''] = text.split('.')
  const cents = Number(intPart) * 100 + Number((decimal + '00').slice(0, 2))
  return Number.isFinite(cents) && cents > 0 ? cents : null
}

export function formatYuan(cents: number): string {
  return (cents / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
export function isValidDate(value: string): boolean {
  if (!ISO_DATE.test(value)) {
    return false
  }
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
}

export function statusRank(status: ProjectStatus): number {
  return PROJECT_STATUSES.indexOf(status)
}

export function freshLedgerState(): LedgerState {
  return { projects: [], maintenanceSchedule: [], seqProject: 0, seqExpense: 0, seqMaintenance: 0 }
}

export function findProject(state: LedgerState, id: number): RenovationProject | undefined {
  return state.projects.find((p) => p.id === id)
}

export function spentCents(project: RenovationProject): number {
  return project.expenses.reduce((sum, item) => sum + item.amountCents, 0)
}

export function remainingCents(project: RenovationProject): number {
  return project.approvedBudgetCents - spentCents(project)
}

/** 费用当前“卡在谁那里”：没有任何费用时落在项目经理，否则取最后一条的办理人。 */
export function currentHandler(project: RenovationProject): string {
  const last = project.expenses[project.expenses.length - 1]
  return last?.handler || project.manager
}

type ExpenseInput = {
  title: string
  amountRaw: string | number
  invoiceNo: string
  settledAt: string
  handler: string
}

/** 逐项校验费用条目，返回错误格与规整后的金额；发票号/结算日期缺失会被明确点名。 */
function validateExpense(input: ExpenseInput, project: RenovationProject): {
  errors: string[]
  amountCents: number | null
} {
  const errors: string[] = []
  const title = input.title.trim()
  const invoiceNo = input.invoiceNo.trim()
  const settledAt = input.settledAt.trim()
  const handler = input.handler.trim()
  const amountCents = yuanToCents(input.amountRaw)

  if (!title) {
    errors.push('费用摘要')
  }
  if (amountCents === null) {
    errors.push('费用金额（应为正数，最多两位小数）')
  } else if (amountCents > remainingCents(project)) {
    errors.push(
      `费用金额超出剩余预算（剩余 ${formatYuan(remainingCents(project))} 元）`,
    )
  }
  if (!invoiceNo) {
    errors.push('发票号')
  } else if (project.expenses.some((item) => item.invoiceNo === invoiceNo)) {
    errors.push(`发票号「${invoiceNo}」在本项目已登记，同一笔费用重复提交只算一次`)
  }
  if (!settledAt) {
    errors.push('结算日期')
  } else if (!isValidDate(settledAt)) {
    errors.push('结算日期（应为 YYYY-MM-DD 合法日期）')
  }
  if (!handler) {
    errors.push('办理人')
  }
  return { errors, amountCents }
}

function withProject(
  state: LedgerState,
  id: number,
  produce: (project: RenovationProject) => RenovationProject,
): LedgerState {
  return {
    ...state,
    projects: state.projects.map((p) => (p.id === id ? produce(p) : p)),
  }
}

export type ProjectCreateInput = {
  code: string
  name: string
  substation: string
  ownerDept: string
  manager: string
  budgetRaw: string | number
}

export function createProject(
  state: LedgerState,
  input: ProjectCreateInput,
): ActionResult<LedgerState> {
  const errors: string[] = []
  const code = input.code.trim()
  const name = input.name.trim()
  const substation = input.substation.trim()
  const ownerDept = input.ownerDept.trim()
  const manager = input.manager.trim()
  const budgetCents = yuanToCents(input.budgetRaw)

  if (!code) errors.push('项目编号')
  if (state.projects.some((p) => p.code === code)) {
    errors.push(`项目编号「${code}」已存在`)
  }
  if (!name) errors.push('项目名称')
  if (!substation) errors.push('所属变电站')
  if (!ownerDept) errors.push('责任部门')
  if (!manager) errors.push('项目经理')
  if (budgetCents === null) errors.push('立项预算（应为正数，最多两位小数）')
  if (errors.length) {
    return { ok: false, message: `立项被挡回，请补正：${errors.join('、')}`, fields: errors }
  }

  const id = state.seqProject + 1
  const project: RenovationProject = {
    id,
    code,
    name,
    substation,
    ownerDept,
    manager,
    status: '立项',
    approvedBudgetCents: budgetCents as number,
    settlementBudgetCents: null,
    settlementNo: '',
    settledAt: '',
    expenses: [],
    maintenanceRef: '',
    logs: [{ at: todayText(), message: `立项批复，预算 ${formatYuan(budgetCents as number)} 元` }],
    createdAt: todayText(),
  }
  return {
    ok: true,
    message: `项目 ${code} 已立项，批复预算 ${formatYuan(budgetCents as number)} 元`,
    data: {
      ...state,
      seqProject: id,
      projects: [...state.projects, project],
    },
  }
}

/** 状态流转：只允许相邻的下一步；跳级、回退一律拒收。 */
export function advance(
  state: LedgerState,
  id: number,
  target: ProjectStatus,
): ActionResult<LedgerState> {
  const project = findProject(state, id)
  if (!project) {
    return { ok: false, message: `没有找到编号为 ${id} 的项目` }
  }
  if (project.status === '结算') {
    return {
      ok: false,
      message: `项目「${project.name}」已结算并锁定，不得回退到实施等阶段修改数据`,
    }
  }
  const currentRank = statusRank(project.status)
  const targetRank = statusRank(target)
  if (targetRank <= currentRank) {
    return {
      ok: false,
      message: `状态只能按 立项→评审→实施→结算 顺序流转，当前「${project.status}」不能回退/重复进入「${target}」`,
    }
  }
  if (targetRank !== currentRank + 1) {
    return {
      ok: false,
      message: `跳级拒收：当前「${project.status}」，必须先进入「${
        PROJECT_STATUSES[currentRank + 1]
      }」，不能直接到「${target}」`,
    }
  }
  // 进入实施时没有额外门槛；进入结算必须走 settleProject（带结算单校验）。
  if (target === '结算') {
    return { ok: false, message: '结算须通过「完成结算」提交结算单，不能空口流转' }
  }
  const next = withProject(state, id, (p) => ({
    ...p,
    status: target,
    logs: [...p.logs, { at: todayText(), message: `状态流转：${p.status} → ${target}` }],
  }))
  return { ok: true, message: `项目「${project.name}」已进入「${target}」`, data: next }
}

/** 实施阶段登记费用；其余阶段（含已结算）一律不收。 */
export function addExpense(
  state: LedgerState,
  projectId: number,
  input: ExpenseInput,
): ActionResult<LedgerState> {
  const project = findProject(state, projectId)
  if (!project) {
    return { ok: false, message: `没有找到编号为 ${projectId} 的项目` }
  }
  if (project.status === '结算') {
    return {
      ok: false,
      message: `项目「${project.name}」已结算并锁定，不得回到实施阶段补改费用`,
    }
  }
  if (project.status !== '实施') {
    return {
      ok: false,
      message: `费用只在「实施」阶段登记，当前为「${project.status}」，请先按顺序流转`,
    }
  }
  const { errors, amountCents } = validateExpense(input, project)
  if (errors.length) {
    return { ok: false, message: `费用被挡回，缺/错：${errors.join('；')}`, fields: errors }
  }
  const expense: ExpenseItem = {
    id: state.seqExpense + 1,
    title: input.title.trim(),
    amountCents: amountCents as number,
    invoiceNo: input.invoiceNo.trim(),
    settledAt: input.settledAt.trim(),
    handler: input.handler.trim(),
    createdAt: todayText(),
  }
  const next = withProject(state, projectId, (p) => ({
    ...p,
    expenses: [...p.expenses, expense],
    logs: [
      ...p.logs,
      {
        at: todayText(),
        message: `登记费用 ${expense.title} ${formatYuan(expense.amountCents)} 元（发票 ${expense.invoiceNo}，办理人 ${expense.handler}）`,
      },
    ],
  }))
  next.seqExpense = expense.id
  return {
    ok: true,
    message: `费用已登记，剩余预算 ${formatYuan(
      remainingCents(findProject(next, projectId) as RenovationProject),
    )} 元`,
    data: next,
  }
}

export type SettlementInput = {
  /** 结算单填写的预算（元）：与立项预算冲突时以立项预算为准，这里只留痕，不覆盖 */
  settlementBudgetRaw: string | number
  mainTransformer: string
  category: string
  outageScope: string
  handler: string
}

/**
 * 完成结算：校验阶段、费用、发票号与结算日期、预算一致性；
 * 通过后写结算单、锁定项目、向主变检修待排期清单推送一条（同项目只推一次）。
 */
export function settleProject(
  state: LedgerState,
  projectId: number,
  input: SettlementInput,
): ActionResult<LedgerState> {
  const project = findProject(state, projectId)
  if (!project) {
    return { ok: false, message: `没有找到编号为 ${projectId} 的项目` }
  }
  if (project.status === '结算') {
    return {
      ok: false,
      message: `项目「${project.name}」已结算并锁定，不得回到实施阶段改数`,
    }
  }
  if (project.status !== '实施') {
    const rank = statusRank(project.status)
    return {
      ok: false,
      message: `跳级拒收：当前「${project.status}」，须先进入「${PROJECT_STATUSES[rank + 1]}」，不能直接结算`,
    }
  }

  const fields: string[] = []
  const settlementBudgetCents = yuanToCents(input.settlementBudgetRaw)
  if (settlementBudgetCents === null) {
    fields.push('结算单预算（应为正数，最多两位小数）')
  }
  const mainTransformer = input.mainTransformer.trim()
  const category = input.category.trim()
  const outageScope = input.outageScope.trim()
  const handler = input.handler.trim()
  if (!mainTransformer) fields.push('主变名称')
  if (!category) fields.push('检修类别')
  if (!outageScope) fields.push('停电范围')
  if (!handler) fields.push('结算办理人')
  if (project.expenses.length === 0) {
    fields.push('费用明细（至少登记一笔费用才能结算）')
  }
  // 逐条复核发票号、结算日期——历史登记已挡，结算闸口再兜一次底。
  const missing: string[] = []
  for (const item of project.expenses) {
    if (!item.invoiceNo) missing.push(`费用「${item.title || item.id}」缺发票号`)
    if (!item.settledAt) missing.push(`费用「${item.title || item.id}」缺结算日期`)
    else if (!isValidDate(item.settledAt)) {
      missing.push(`费用「${item.title}」结算日期「${item.settledAt}」不合法`)
    }
  }
  if (missing.length) {
    fields.push(...missing)
  }

  let budgetConflict = false
  if (
    settlementBudgetCents !== null &&
    settlementBudgetCents !== project.approvedBudgetCents
  ) {
    budgetConflict = true
  }

  if (fields.length || budgetConflict) {
    const parts = [...fields]
    if (budgetConflict) {
      parts.push(
        `结算单预算 ${formatYuan(settlementBudgetCents as number)} 元与批复立项预算 ${formatYuan(
          project.approvedBudgetCents,
        )} 元不一致；两处预算须同步，冲突以立项预算为准，请把结算单改为 ${formatYuan(
          project.approvedBudgetCents,
        )} 元后再提交`,
      )
    }
    return {
      ok: false,
      message: `结算被挡回：${parts.join('；')}`,
      fields: parts,
    }
  }

  const settledAt = todayText()
  const settlementNo = `JS-${project.code}-${settledAt.replace(/-/g, '')}`
  let next: LedgerState = withProject(state, projectId, (p) => ({
    ...p,
    status: '结算',
    settlementBudgetCents: settlementBudgetCents as number,
    settlementNo,
    settledAt,
    logs: [
      ...p.logs,
      {
        at: settledAt,
        message: `完成结算，结算单号 ${settlementNo}，累计 ${formatYuan(spentCents(p))} 元，预算以立项批复 ${formatYuan(
          p.approvedBudgetCents,
        )} 元为准`,
      },
      { at: settledAt, message: `结算结果已推送至主变检修待排期清单（办理人 ${handler}）` },
    ],
  }))

  // 已推送过就不重复推送（同一项目结算结果只反映一次）。
  const alreadyPushed = state.maintenanceSchedule.some(
    (item) => item.sourceProjectId === projectId,
  )
  if (!alreadyPushed) {
    const maintenanceId = state.seqMaintenance + 1
    const settledProject = findProject(next, projectId) as RenovationProject
    next = {
      ...next,
      seqMaintenance: maintenanceId,
      maintenanceSchedule: [
        {
          id: maintenanceId,
          maintenanceNo: `ZX-${String(maintenanceId).padStart(4, '0')}`,
          sourceProjectId: projectId,
          sourceProjectCode: project.code,
          substation: project.substation,
          mainTransformer,
          category,
          outageScope,
          budgetCents: spentCents(settledProject),
          settledAt,
          createdAt: settledAt,
        },
        ...next.maintenanceSchedule,
      ],
    }
    next = withProject(next, projectId, (p) => ({
      ...p,
      maintenanceRef: `ZX-${String(maintenanceId).padStart(4, '0')}`,
    }))
  }

  return {
    ok: true,
    message: `结算完成：${settlementNo}，已同步到主变检修待排期清单`,
    data: next,
  }
}
