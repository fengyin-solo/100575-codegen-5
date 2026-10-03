import { computed, ref } from 'vue'

import {
  addExpense as svcAddExpense,
  advance as svcAdvance,
  createProject as svcCreateProject,
  currentHandler,
  formatYuan,
  remainingCents,
  settleProject as svcSettleProject,
  spentCents,
} from './ledger-service'
import { buildSeedLedger } from './seed'
import { readLedger, resetLedger, saveLedger } from './ledger-store'
import type {
  ActionResult,
  ExpenseItem,
  LedgerState,
  MaintenanceScheduleItem,
  ProjectStatus,
  RenovationProject,
} from './types'
import type { ProjectCreateInput, SettlementInput } from './ledger-service'

// 单例：整册台账一份状态，所有页面共享。
const state = ref<LedgerState>(readLedger(buildSeedLedger()))

function commit(result: ActionResult<LedgerState>): ActionResult {
  if (result.ok && result.data) {
    state.value = result.data
    saveLedger(state.value)
  }
  return { ok: result.ok, message: result.message, fields: result.fields }
}

export function useRenovationLedger() {
  const projects = computed(() => state.value.projects)
  const maintenanceSchedule = computed(() => state.value.maintenanceSchedule)

  function projectById(id: number): RenovationProject | undefined {
    return state.value.projects.find((p) => p.id === id)
  }

  function create(input: ProjectCreateInput): ActionResult {
    return commit(svcCreateProject(state.value, input))
  }

  function moveTo(id: number, target: ProjectStatus): ActionResult {
    return commit(svcAdvance(state.value, id, target))
  }

  function addExpense(
    id: number,
    input: {
      title: string
      amountRaw: string
      invoiceNo: string
      settledAt: string
      handler: string
    },
  ): ActionResult {
    return commit(svcAddExpense(state.value, id, input))
  }

  function settle(id: number, input: SettlementInput): ActionResult {
    return commit(svcSettleProject(state.value, id, input))
  }

  function resetToSeed(): void {
    state.value = resetLedger(buildSeedLedger())
  }

  return {
    projects,
    maintenanceSchedule,
    projectById,
    create,
    moveTo,
    addExpense,
    settle,
    resetToSeed,
  }
}

export type {
  ActionResult,
  ExpenseItem,
  MaintenanceScheduleItem,
  ProjectStatus,
  RenovationProject,
}
export { currentHandler, formatYuan, remainingCents, spentCents }
