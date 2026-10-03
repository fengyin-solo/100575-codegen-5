import { freshLedgerState } from './ledger-service'
import type { LedgerState } from './types'

// 保护技改台账独立存放，避免与通用模块的 entries 混在一起。
const STORAGE_KEY = 'substation-protection:renovation-ledger'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 示例数据延迟生成：种子工厂见 seed.ts，测试环境不会触碰 localStorage。
export function readLedger(seed?: LedgerState): LedgerState {
  const fallback = clone(seed ?? freshLedgerState())
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    // 与空骨架合并，保证后续新增字段也有默认值。
    return { ...freshLedgerState(), ...(JSON.parse(raw) as LedgerState) }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

export function saveLedger(state: LedgerState): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }
}

export function resetLedger(seed?: LedgerState): LedgerState {
  const fresh = clone(seed ?? freshLedgerState())
  saveLedger(fresh)
  return fresh
}

export function ledgerStorageKey(): string {
  return STORAGE_KEY
}
