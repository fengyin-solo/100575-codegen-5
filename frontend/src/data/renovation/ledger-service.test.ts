import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  addExpense,
  advance,
  createProject,
  findProject,
  freshLedgerState,
  remainingCents,
  settleProject,
  spentCents,
  yuanToCents,
} from './ledger-service'
import type { LedgerState } from './types'

function newProject(state: LedgerState, budget = '100000') {
  const result = createProject(state, {
    code: 'JG-T-001',
    name: '测试技改',
    substation: '测试变',
    ownerDept: '继保班',
    manager: '张三',
    budgetRaw: budget,
  })
  assert.equal(result.ok, true, result.message)
  return result.data as LedgerState
}

const expenseInput = (over: Partial<Parameters<typeof addExpense>[2]> = {}) => ({
  title: '装置采购',
  amountRaw: '30000',
  invoiceNo: 'FP-1',
  settledAt: '2026-09-10',
  handler: '李四',
  ...over,
})

test('立项：字段缺失逐项挡回，预算金额非法拒收', () => {
  const bad = createProject(freshLedgerState(), {
    code: '',
    name: '',
    substation: '',
    ownerDept: '',
    manager: '',
    budgetRaw: 'abc',
  })
  assert.equal(bad.ok, false)
  for (const field of ['项目编号', '项目名称', '所属变电站', '责任部门', '项目经理', '立项预算']) {
    assert.ok(bad.fields?.some((f) => f.includes(field)), `应点名缺少 ${field}`)
  }

  const dup = newProject(freshLedgerState())
  const again = createProject(dup, {
    code: 'JG-T-001',
    name: '另一个',
    substation: 'x',
    ownerDept: 'x',
    manager: 'x',
    budgetRaw: '1',
  })
  assert.equal(again.ok, false)
  assert.match(again.message, /已存在/)

  assert.equal(yuanToCents('12.345'), null)
  assert.equal(yuanToCents('0'), null)
  assert.equal(yuanToCents('12.3'), 1230)
})

test('状态只能相邻流转：跳级拒收、回退拒收、结算只能走结算单', () => {
  let s = newProject(freshLedgerState())
  // 立项直接跳结算/实施：拒收
  assert.equal(advance(s, 1, '结算').ok, false)
  assert.match(advance(s, 1, '结算').message, /跳级/)
  assert.equal(advance(s, 1, '实施').ok, false)
  // 正确推进到评审
  const toReview = advance(s, 1, '评审')
  assert.equal(toReview.ok, true)
  s = toReview.data as LedgerState
  // 回退拒收
  assert.equal(advance(s, 1, '立项').ok, false)
  assert.match(advance(s, 1, '立项').message, /不能回退/)
  const toImpl = advance(s, 1, '实施')
  assert.equal(toImpl.ok, true)
  s = toImpl.data as LedgerState
  // 实施 → 结算 不能空口流转
  const direct = advance(s, 1, '结算')
  assert.equal(direct.ok, false)
  assert.match(direct.message, /完成结算/)
})

test('费用只能在实施阶段登记；缺发票号或结算日期逐格挡回', () => {
  let s = newProject(freshLedgerState())
  // 立项阶段不能登记费用
  assert.equal(addExpense(s, 1, expenseInput()).ok, false)
  s = (advance(s, 1, '评审').data as LedgerState)
  // 评审阶段也不能
  assert.equal(addExpense(s, 1, expenseInput()).ok, false)
  s = (advance(s, 1, '实施').data as LedgerState)

  const noInvoice = addExpense(s, 1, expenseInput({ invoiceNo: '  ' }))
  assert.equal(noInvoice.ok, false)
  assert.ok(noInvoice.fields?.includes('发票号'))
  assert.match(noInvoice.message, /发票号/)

  const noDate = addExpense(s, 1, expenseInput({ invoiceNo: 'FP-2', settledAt: '' }))
  assert.equal(noDate.ok, false)
  assert.ok(noDate.fields?.includes('结算日期'))

  const badDate = addExpense(
    s,
    1,
    expenseInput({ invoiceNo: 'FP-2', settledAt: '2026-02-30' }),
  )
  assert.equal(badDate.ok, false)
  assert.match(badDate.message, /结算日期/)

  const missingBoth = addExpense(
    s,
    1,
    expenseInput({ invoiceNo: '', settledAt: '' }),
  )
  assert.equal(missingBoth.ok, false)
  assert.ok(missingBoth.fields?.includes('发票号'))
  assert.ok(missingBoth.fields?.includes('结算日期'))

  const ok = addExpense(s, 1, expenseInput())
  assert.equal(ok.ok, true)
  s = ok.data as LedgerState
  const project = findProject(s, 1)!
  assert.equal(spentCents(project), 30000_00)
  assert.equal(remainingCents(project), 70000_00)
})

test('同一笔费用（同发票号）重复提交只算一次', () => {
  let s = newProject(freshLedgerState())
  s = (advance(s, 1, '评审').data as LedgerState)
  s = (advance(s, 1, '实施').data as LedgerState)
  s = (addExpense(s, 1, expenseInput()).data as LedgerState)
  // 换摘要、换金额但发票号相同：仍判重复
  const dup = addExpense(
    s,
    1,
    expenseInput({ title: '改头换面', amountRaw: '100' }),
  )
  assert.equal(dup.ok, false)
  assert.match(dup.message, /重复提交只算一次/)
  assert.equal(findProject(s, 1)!.expenses.length, 1)
  assert.equal(spentCents(findProject(s, 1)!), 30000_00)
})

test('费用不得超出立项预算剩余额度', () => {
  let s = newProject(freshLedgerState(), '50000')
  s = (advance(s, 1, '评审').data as LedgerState)
  s = (advance(s, 1, '实施').data as LedgerState)
  const over = addExpense(s, 1, expenseInput({ amountRaw: '60000' }))
  assert.equal(over.ok, false)
  assert.match(over.message, /超出剩余预算/)
})

test('结算：预算冲突以立项预算为准（挡回要求改齐），两处同步后才放行', () => {
  let s = newProject(freshLedgerState(), '100000')
  s = (advance(s, 1, '评审').data as LedgerState)
  s = (advance(s, 1, '实施').data as LedgerState)
  s = (addExpense(s, 1, expenseInput()).data as LedgerState)

  const conflict = settleProject(s, 1, {
    settlementBudgetRaw: '90000',
    mainTransformer: '1号主变',
    category: '停电检修',
    outageScope: '全停',
    handler: '王五',
  })
  assert.equal(conflict.ok, false)
  assert.match(conflict.message, /以立项预算为准/)
  // 被挡回时立项预算绝不能被结算单覆盖
  assert.equal(findProject(s, 1)!.approvedBudgetCents, 100000_00)
  assert.equal(findProject(s, 1)!.status, '实施')

  const ok = settleProject(s, 1, {
    settlementBudgetRaw: '100000',
    mainTransformer: '1号主变',
    category: '停电检修',
    outageScope: '全停',
    handler: '王五',
  })
  assert.equal(ok.ok, true, ok.message)
  s = ok.data as LedgerState
  const project = findProject(s, 1)!
  assert.equal(project.status, '结算')
  assert.equal(project.approvedBudgetCents, project.settlementBudgetCents)
  assert.match(project.settlementNo, /^JS-JG-T-001-/)
})

test('结算闸口：没有费用 / 结算单字段缺失被挡回', () => {
  let s = newProject(freshLedgerState())
  s = (advance(s, 1, '评审').data as LedgerState)
  s = (advance(s, 1, '实施').data as LedgerState)
  const none = settleProject(s, 1, {
    settlementBudgetRaw: '100000',
    mainTransformer: '',
    category: '',
    outageScope: '',
    handler: '',
  })
  assert.equal(none.ok, false)
  assert.ok(none.fields?.some((f) => f.includes('费用明细')))
  assert.ok(none.fields?.includes('主变名称'))
  assert.ok(none.fields?.includes('检修类别'))
  assert.ok(none.fields?.includes('停电范围'))
  assert.ok(none.fields?.includes('结算办理人'))
})

test('已结算项目锁定：不能回实施、不能补费用、不能再改数，也不能重复推送待排期', () => {
  let s = newProject(freshLedgerState())
  s = (advance(s, 1, '评审').data as LedgerState)
  s = (advance(s, 1, '实施').data as LedgerState)
  s = (addExpense(s, 1, expenseInput()).data as LedgerState)
  s = (
    settleProject(s, 1, {
      settlementBudgetRaw: '100000',
      mainTransformer: '1号主变',
      category: '停电检修',
      outageScope: '全停',
      handler: '王五',
    }).data as LedgerState
  )

  assert.equal(advance(s, 1, '实施').ok, false)
  assert.match(advance(s, 1, '实施').message, /已结算并锁定/)
  assert.equal(addExpense(s, 1, expenseInput({ invoiceNo: 'FP-9' })).ok, false)
  const resettle = settleProject(s, 1, {
    settlementBudgetRaw: '100000',
    mainTransformer: '1号主变',
    category: '停电检修',
    outageScope: '全停',
    handler: '王五',
  })
  assert.equal(resettle.ok, false)
  assert.match(resettle.message, /已结算/)
  assert.equal(s.maintenanceSchedule.length, 1)
  assert.equal(s.maintenanceSchedule[0].sourceProjectCode, 'JG-T-001')
})

test('结算完成自动进入主变检修待排期清单，金额取实际结算费用', () => {
  let s = newProject(freshLedgerState())
  s = (advance(s, 1, '评审').data as LedgerState)
  s = (advance(s, 1, '实施').data as LedgerState)
  s = (addExpense(s, 1, expenseInput({ amountRaw: '30000' })).data as LedgerState)
  s = (
    addExpense(s, 1, expenseInput({
      title: '调试费',
      amountRaw: '15000',
      invoiceNo: 'FP-2',
      settledAt: '2026-09-12',
    })).data as LedgerState
  )
  s = (
    settleProject(s, 1, {
      settlementBudgetRaw: '100000',
      mainTransformer: '2号主变',
      category: '保护改造后检修',
      outageScope: '2号主变全停',
      handler: '王五',
    }).data as LedgerState
  )
  assert.equal(s.maintenanceSchedule.length, 1)
  const item = s.maintenanceSchedule[0]
  assert.equal(item.budgetCents, 45000_00)
  assert.equal(item.mainTransformer, '2号主变')
  assert.equal(findProject(s, 1)!.maintenanceRef, item.maintenanceNo)
})
