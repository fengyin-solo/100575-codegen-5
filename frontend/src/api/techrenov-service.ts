import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 保护技改项目立项与费用结算台账的专用规则。
// 项目台账（techrenov）与结算单（techrenovsettle）是两本关联的账：
// 状态只按 立项→评审→实施→结算 依次流转；结算单的预算以批复的立项预算为准；
// 结算完成后把对应主变写进主变检修的待排期清单；同一笔费用重复提交只计一次。
export const TECHRENOV_KEY = 'techrenov'
export const SETTLE_KEY = 'techrenovsettle'
const MAINT_KEY = 'transformermaint'

const FLOW = ['立项', '评审', '实施', '结算'] as const
const ACTION_FLOW: Record<string, { from: string; to: string }> = {
  提交评审: { from: '立项', to: '评审' },
  评审通过: { from: '评审', to: '实施' },
  办理结算: { from: '实施', to: '结算' },
}

const BUDGET_FIELD = '批复预算(万元)'
const SPENT_FIELD = '累计费用(万元)'
const SETTLE_BUDGET_FIELD = '结算单预算(万元)'
const SETTLE_AMOUNT_FIELD = '结算金额(万元)'

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function asAmount(value: unknown): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

function nextCode(rows: EntryRow[], field: string, prefix: string): string {
  const year = new Date().getFullYear()
  let max = 0
  for (const row of rows) {
    const match = String(row[field] ?? '').match(/(\d+)$/)
    if (match) {
      max = Math.max(max, Number(match[1]))
    }
  }
  return `${prefix}-${year}-${String(max + 1).padStart(3, '0')}`
}

function findProject(id: number): { rows: EntryRow[]; index: number } | null {
  const rows = listRows(TECHRENOV_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  return index < 0 ? null : { rows, index }
}

function settleRowsOf(projectCode: string): EntryRow[] {
  return listRows(SETTLE_KEY).filter((row) => String(row['项目编号']) === projectCode)
}

function totalSpent(projectCode: string): number {
  return round2(
    settleRowsOf(projectCode).reduce((sum, row) => sum + asAmount(row[SETTLE_AMOUNT_FIELD]), 0),
  )
}

/** 结算单预算一律对齐批复的立项预算，返回被更正的结算单号。 */
function syncSettleBudgets(projectCode: string, approvedBudget: number): string[] {
  const rows = listRows(SETTLE_KEY)
  const fixed: string[] = []
  const next = rows.map((row) => {
    if (String(row['项目编号']) !== projectCode) {
      return row
    }
    if (asAmount(row[SETTLE_BUDGET_FIELD]) === approvedBudget) {
      return row
    }
    fixed.push(String(row['结算单号']))
    return { ...row, [SETTLE_BUDGET_FIELD]: approvedBudget }
  })
  if (fixed.length > 0) {
    saveRows(SETTLE_KEY, next)
  }
  return fixed
}

export function listSettlements(projectCode: string): EntryRow[] {
  return settleRowsOf(projectCode)
}

export function createProject(input: {
  项目名称: string
  所属变电站: string
  关联主变: string
  批复预算: number
  立项日期: string
  负责人: string
}): ActionResult & { row?: EntryRow } {
  if (!input.项目名称.trim() || !input.所属变电站.trim() || !input.负责人.trim()) {
    return { ok: false, message: '项目名称、所属变电站、负责人三格都要填' }
  }
  if (!Number.isFinite(input.批复预算) || input.批复预算 <= 0) {
    return { ok: false, message: '批复预算要填大于 0 的数字（万元）' }
  }
  const rows = listRows(TECHRENOV_KEY)
  const row: EntryRow = {
    id: rows.reduce((max, item) => Math.max(max, Number(item.id)), 0) + 1,
    status: '立项',
    pending: true,
    abnormal: false,
    项目编号: nextCode(rows, '项目编号', 'JG'),
    项目名称: input.项目名称.trim(),
    所属变电站: input.所属变电站.trim(),
    关联主变: input.关联主变.trim(),
    [BUDGET_FIELD]: round2(input.批复预算),
    [SPENT_FIELD]: 0,
    立项日期: input.立项日期 || new Date().toISOString().slice(0, 10),
    负责人: input.负责人.trim(),
  }
  saveRows(TECHRENOV_KEY, [...rows, row])
  return { ok: true, message: `技改项目「${row['项目编号']}」已立项，批复预算 ${row[BUDGET_FIELD]} 万元`, row }
}

/** 状态流转：只许 立项→评审→实施→结算 逐级走，跳级拒收，已结算锁死。 */
export function runTechrenovAction(id: number, action: string): ActionResult {
  const step = ACTION_FLOW[action]
  if (!step) {
    return { ok: false, message: `技改项目没有登记「${action}」这个动作` }
  }
  const found = findProject(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的技改项目` }
  }
  const { rows, index } = found
  const project = rows[index]
  const code = String(project['项目编号'])
  const current = String(project.status)
  if (current === '结算') {
    return { ok: false, message: `「${code}」已结算，流程到此为止，不许回退到实施阶段改数` }
  }
  if (current !== step.from) {
    return {
      ok: false,
      message: `「${code}」当前处于「${current}」，须按 立项→评审→实施→结算 依次流转，不能跳到「${step.to}」`,
    }
  }
  if (action === '办理结算') {
    return settleProject(rows, index, code)
  }
  const next = [...rows]
  next[index] = { ...project, status: step.to, pending: true }
  saveRows(TECHRENOV_KEY, next)
  return { ok: true, message: `「${code}」已${action}，当前状态「${step.to}」` }
}

function settleProject(rows: EntryRow[], index: number, code: string): ActionResult {
  const sheets = settleRowsOf(code)
  if (sheets.length === 0) {
    return { ok: false, message: `「${code}」还没有结算单，先登记费用再办理结算` }
  }
  const missing: string[] = []
  for (const sheet of sheets) {
    const gaps: string[] = []
    if (String(sheet['发票号'] ?? '').trim() === '') {
      gaps.push('发票号')
    }
    if (String(sheet['结算日期'] ?? '').trim() === '') {
      gaps.push('结算日期')
    }
    if (gaps.length > 0) {
      missing.push(`结算单「${sheet['结算单号']}」缺${gaps.join('、')}`)
    }
  }
  if (missing.length > 0) {
    return { ok: false, message: `结算挡回：${missing.join('；')}，补齐后再办理` }
  }
  const project = rows[index]
  const spent = totalSpent(code)
  const next = [...rows]
  next[index] = { ...project, status: '结算', pending: false, [SPENT_FIELD]: spent }
  saveRows(TECHRENOV_KEY, next)
  syncSettleBudgets(code, asAmount(project[BUDGET_FIELD]))
  const maintCode = enqueueMaintenance(project)
  return {
    ok: true,
    message: `「${code}」已结算，累计费用 ${spent} 万元；已加入主变检修待排期清单（${maintCode}）`,
  }
}

/** 结算完成 → 主变检修待排期清单；同一项目只排一次。 */
function enqueueMaintenance(project: EntryRow): string {
  const maintCode = `MT-${project['项目编号']}`
  const rows = listRows(MAINT_KEY)
  if (rows.some((row) => String(row['检修编号']) === maintCode)) {
    return maintCode
  }
  const row: EntryRow = {
    id: rows.reduce((max, item) => Math.max(max, Number(item.id)), 0) + 1,
    status: '待排期',
    pending: true,
    abnormal: false,
    检修编号: maintCode,
    主变名称: project['关联主变'] ?? '',
    检修类别: '技改交接检修',
    停电范围: project['所属变电站'] ?? '',
    检修班组: '待指派',
    计划工期: '待排期',
    完成日期: '',
    检修状态: '待排期',
  }
  saveRows(MAINT_KEY, [...rows, row])
  return maintCode
}

/** 登记一笔费用：同一笔费用（同发票号，或同费用名称+金额）重复提交只计一次。 */
export function submitExpense(
  projectId: number,
  input: { 费用名称: string; 发票号: string; 结算金额: number; 结算日期: string; 提交人: string },
): ActionResult {
  const found = findProject(projectId)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${projectId} 的技改项目` }
  }
  const { rows, index } = found
  const project = rows[index]
  const code = String(project['项目编号'])
  if (String(project.status) === '结算') {
    return { ok: false, message: `「${code}」已结算，不许再改费用` }
  }
  if (!input.费用名称.trim()) {
    return { ok: false, message: '费用名称这一格要填' }
  }
  if (!Number.isFinite(input.结算金额) || input.结算金额 <= 0) {
    return { ok: false, message: '结算金额要填大于 0 的数字（万元）' }
  }
  const invoice = input.发票号.trim()
  const amount = round2(input.结算金额)
  const all = listRows(SETTLE_KEY)
  const duplicate = all.find(
    (row) =>
      String(row['项目编号']) === code &&
      ((invoice !== '' && String(row['发票号']) === invoice) ||
        (String(row['费用名称']) === input.费用名称.trim() &&
          asAmount(row[SETTLE_AMOUNT_FIELD]) === amount)),
  )
  if (duplicate) {
    return {
      ok: true,
      message: `该笔费用已登记在结算单「${duplicate['结算单号']}」，重复提交只计一次`,
    }
  }
  const sheet: EntryRow = {
    id: all.reduce((max, item) => Math.max(max, Number(item.id)), 0) + 1,
    status: '已登记',
    pending: invoice === '' || input.结算日期.trim() === '',
    abnormal: false,
    结算单号: nextCode(all, '结算单号', 'JS'),
    项目编号: code,
    费用名称: input.费用名称.trim(),
    发票号: invoice,
    [SETTLE_AMOUNT_FIELD]: amount,
    [SETTLE_BUDGET_FIELD]: asAmount(project[BUDGET_FIELD]),
    结算日期: input.结算日期.trim(),
    提交人: input.提交人.trim(),
  }
  saveRows(SETTLE_KEY, [...all, sheet])
  refreshSpent(rows, index, code)
  return { ok: true, message: `结算单「${sheet['结算单号']}」已登记，金额 ${amount} 万元` }
}

/** 给已登记的结算单补录发票号、结算日期（只填空着的格子）。 */
export function completeExpense(
  settleId: number,
  input: { 发票号: string; 结算日期: string },
): ActionResult {
  const all = listRows(SETTLE_KEY)
  const index = all.findIndex((row) => Number(row.id) === settleId)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${settleId} 的结算单` }
  }
  const sheet = all[index]
  const code = String(sheet['项目编号'])
  const projectRows = listRows(TECHRENOV_KEY)
  const project = projectRows.find((row) => String(row['项目编号']) === code)
  if (project && String(project.status) === '结算') {
    return { ok: false, message: `「${code}」已结算，不许再补录改数` }
  }
  const invoice = input.发票号.trim()
  const date = input.结算日期.trim()
  if (invoice === '' && date === '') {
    return { ok: false, message: '发票号、结算日期至少补一格' }
  }
  const next = [...all]
  const merged: EntryRow = { ...sheet }
  if (String(merged['发票号']).trim() === '' && invoice !== '') {
    merged['发票号'] = invoice
  }
  if (String(merged['结算日期']).trim() === '' && date !== '') {
    merged['结算日期'] = date
  }
  merged.pending = String(merged['发票号']).trim() === '' || String(merged['结算日期']).trim() === ''
  next[index] = merged
  saveRows(SETTLE_KEY, next)
  return { ok: true, message: `结算单「${sheet['结算单号']}」已补录` }
}

/** 调整批复预算（立项预算），结算单预算跟着同步；已结算的不许改。 */
export function adjustBudget(projectId: number, budget: number): ActionResult {
  const found = findProject(projectId)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${projectId} 的技改项目` }
  }
  const { rows, index } = found
  const project = rows[index]
  const code = String(project['项目编号'])
  if (String(project.status) === '结算') {
    return { ok: false, message: `「${code}」已结算，预算不许再改` }
  }
  if (!Number.isFinite(budget) || budget <= 0) {
    return { ok: false, message: '批复预算要填大于 0 的数字（万元）' }
  }
  const value = round2(budget)
  const next = [...rows]
  next[index] = { ...project, [BUDGET_FIELD]: value }
  saveRows(TECHRENOV_KEY, next)
  const fixed = syncSettleBudgets(code, value)
  const tail =
    fixed.length > 0 ? `，同步更正结算单预算：${fixed.join('、')}` : '，结算单预算已一致'
  return { ok: true, message: `「${code}」批复预算调整为 ${value} 万元${tail}` }
}

/** 预算对账：凡结算单预算与批复的立项预算不一致的，一律以批复预算为准更正。 */
export function reconcileBudgets(): ActionResult {
  const projects = listRows(TECHRENOV_KEY)
  const sheets = listRows(SETTLE_KEY)
  const budgetByCode = new Map(
    projects.map((row) => [String(row['项目编号']), asAmount(row[BUDGET_FIELD])]),
  )
  const fixed: string[] = []
  const next = sheets.map((sheet) => {
    const approved = budgetByCode.get(String(sheet['项目编号']))
    if (approved === undefined || asAmount(sheet[SETTLE_BUDGET_FIELD]) === approved) {
      return sheet
    }
    fixed.push(`结算单「${sheet['结算单号']}」${asAmount(sheet[SETTLE_BUDGET_FIELD])}→${approved}`)
    return { ...sheet, [SETTLE_BUDGET_FIELD]: approved }
  })
  if (fixed.length === 0) {
    return { ok: true, message: '预算对账完成：项目台账与结算单预算全部一致' }
  }
  saveRows(SETTLE_KEY, next)
  return { ok: true, message: `预算对账完成，以批复的立项预算为准更正 ${fixed.length} 处：${fixed.join('；')}` }
}

function refreshSpent(rows: EntryRow[], index: number, code: string): void {
  const next = [...rows]
  next[index] = { ...rows[index], [SPENT_FIELD]: totalSpent(code) }
  saveRows(TECHRENOV_KEY, next)
}

export function downloadSettlements(projectCode: string): void {
  const header = ['结算单号', '项目编号', '费用名称', '发票号', '结算金额(万元)', '结算单预算(万元)', '结算日期', '提交人']
  const lines = [header.join(',')]
  for (const row of settleRowsOf(projectCode)) {
    lines.push(header.map((field) => row[field] ?? '').join(','))
  }
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `技改结算单-${projectCode}.csv`
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
