<template>
  <section class="page" data-module="techrenov">
    <header class="page-head">
      <div>
        <h2>保护技改项目立项与费用结算台账</h2>
        <p class="page-desc">一条项目从立项一路走到结算：立项、评审、实施、结算依次流转，跳级拒收；结算单预算以批复的立项预算为准；结算完成后自动进入主变检修待排期清单。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="toggleCreate">登记技改项目</button>
        <button class="btn" type="button" @click="reconcile">预算对账</button>
        <button class="btn" type="button" @click="exportRows">导出项目清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form v-if="showCreate" class="filter-bar" @submit.prevent="submitCreate">
      <label class="filter-item">
        <span>项目名称</span>
        <input v-model="createForm.项目名称" placeholder="如：城北变主变保护技改" />
      </label>
      <label class="filter-item">
        <span>所属变电站</span>
        <input v-model="createForm.所属变电站" placeholder="如：城北110kV变电站" />
      </label>
      <label class="filter-item">
        <span>关联主变</span>
        <input v-model="createForm.关联主变" placeholder="如：城北变3号主变" />
      </label>
      <label class="filter-item">
        <span>批复预算(万元)</span>
        <input v-model="createForm.批复预算" type="number" min="0" step="0.01" placeholder="批复的立项预算" />
      </label>
      <label class="filter-item">
        <span>立项日期</span>
        <input v-model="createForm.立项日期" type="date" />
      </label>
      <label class="filter-item">
        <span>负责人</span>
        <input v-model="createForm.负责人" />
      </label>
      <button class="btn primary" type="submit">提交立项</button>
      <button class="btn ghost" type="button" @click="toggleCreate">取消</button>
    </form>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <template v-if="budgetEditId === Number(row.id)">
              <input v-model="budgetInput" type="number" min="0" step="0.01" class="budget-input" />
              <button class="link" type="button" @click="confirmBudget(row)">确认</button>
              <button class="link" type="button" @click="budgetEditId = null">取消</button>
            </template>
            <template v-else>
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="runTransition(action, row)"
              >
                {{ action }}
              </button>
              <button class="link" type="button" @click="openSettle(row)">结算单</button>
              <button class="link" type="button" @click="startBudget(row)">调整预算</button>
            </template>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无技改项目，可先登记技改项目</td>
        </tr>
      </tbody>
    </table>

    <section v-if="selectedProject" class="settle-panel">
      <header class="page-head">
        <div>
          <h3>结算单 · {{ selectedProject['项目编号'] }}（{{ selectedProject['项目名称'] }}）</h3>
          <p class="page-desc">
            批复预算 {{ selectedProject['批复预算(万元)'] }} 万元 · 累计费用 {{ selectedProject['累计费用(万元)'] }} 万元 · 剩余 {{ budgetLeft }} 万元
          </p>
        </div>
        <div class="page-actions">
          <button class="btn" type="button" @click="exportSettles">导出结算单</button>
          <button class="btn ghost" type="button" @click="closeSettle">关闭</button>
        </div>
      </header>

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in settleColumns" :key="column">{{ column }}</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="sheet in settleRows" :key="String(sheet.id)" :class="{ 'row-incomplete': isIncomplete(sheet) }">
            <td>{{ sheet['结算单号'] }}</td>
            <td>{{ sheet['费用名称'] }}</td>
            <td>
              <input
                v-if="isBlank(sheet['发票号']) && !isSettled"
                v-model="patchForms[Number(sheet.id)].发票号"
                placeholder="缺发票号，补录这里"
              />
              <span v-else>{{ sheet['发票号'] || '—' }}</span>
            </td>
            <td>{{ sheet['结算金额(万元)'] }}</td>
            <td>{{ sheet['结算单预算(万元)'] }}</td>
            <td>
              <input
                v-if="isBlank(sheet['结算日期']) && !isSettled"
                v-model="patchForms[Number(sheet.id)].结算日期"
                type="date"
              />
              <span v-else>{{ sheet['结算日期'] || '—' }}</span>
            </td>
            <td>{{ sheet['提交人'] }}</td>
            <td class="row-actions">
              <button
                v-if="isIncomplete(sheet) && !isSettled"
                class="link"
                type="button"
                @click="patchRow(sheet)"
              >
                补录
              </button>
              <span v-else-if="isIncomplete(sheet)">已锁定</span>
              <span v-else>齐全</span>
            </td>
          </tr>
          <tr v-if="!settleRows.length">
            <td :colspan="settleColumns.length + 1" class="empty-state">还没有结算单，在下方登记第一笔费用</td>
          </tr>
        </tbody>
      </table>

      <form v-if="!isSettled" class="filter-bar" @submit.prevent="submitExpenseForm">
        <label class="filter-item">
          <span>费用名称</span>
          <input v-model="expenseForm.费用名称" placeholder="如：保护装置更换费" />
        </label>
        <label class="filter-item">
          <span>发票号</span>
          <input v-model="expenseForm.发票号" placeholder="可后补" />
        </label>
        <label class="filter-item">
          <span>结算金额(万元)</span>
          <input v-model="expenseForm.结算金额" type="number" min="0" step="0.01" />
        </label>
        <label class="filter-item">
          <span>结算日期</span>
          <input v-model="expenseForm.结算日期" type="date" />
        </label>
        <label class="filter-item">
          <span>提交人</span>
          <input v-model="expenseForm.提交人" />
        </label>
        <button class="btn primary" type="submit">提交费用</button>
      </form>
      <p v-else class="settle-locked">项目已结算，台账锁定，不许再回到实施阶段改数。</p>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条技改项目</span>
      <span v-if="noticeMessage" class="ok-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, listEntries } from '@/api/local-service'
import {
  TECHRENOV_KEY,
  adjustBudget,
  completeExpense,
  createProject,
  downloadSettlements,
  listSettlements,
  reconcileBudgets,
  runTechrenovAction,
  submitExpense,
} from '@/api/techrenov-service'
import { useSessionStore } from '@/stores/session'
import type { ActionResult, EntryRow } from '@/data/types'

const store = useSessionStore()

const columns = ["项目编号", "项目名称", "所属变电站", "关联主变", "批复预算(万元)", "累计费用(万元)", "立项日期", "负责人"]
const actions = ["提交评审", "评审通过", "办理结算"]
const statuses = ["立项", "评审", "实施", "结算"]
const settleColumns = ["结算单号", "费用名称", "发票号", "结算金额(万元)", "结算单预算(万元)", "结算日期", "提交人"]

const rows = ref<EntryRow[]>([])
const statsRows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const showCreate = ref(false)
const createForm = ref({ 项目名称: '', 所属变电站: '', 关联主变: '', 批复预算: '', 立项日期: '', 负责人: '' })

const selectedProject = ref<EntryRow | null>(null)
const settleRows = ref<EntryRow[]>([])
const patchForms = ref<Record<number, { 发票号: string; 结算日期: string }>>({})
const expenseForm = ref({ 费用名称: '', 发票号: '', 结算金额: '', 结算日期: '', 提交人: store.operator })

const budgetEditId = ref<number | null>(null)
const budgetInput = ref('')

const stats = computed(() => [
  { label: '待评审项目', value: countByStatus('立项') },
  { label: '评审中项目', value: countByStatus('评审') },
  { label: '实施中项目', value: countByStatus('实施') },
  { label: '已结算项目', value: countByStatus('结算') },
])
const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: statsRows.value.filter((row) => String(row.status) === status).length,
  })),
)
const isSettled = computed(() => String(selectedProject.value?.status) === '结算')
const budgetLeft = computed(() => {
  if (!selectedProject.value) {
    return 0
  }
  const left = Number(selectedProject.value['批复预算(万元)']) - Number(selectedProject.value['累计费用(万元)'])
  return Math.round(left * 100) / 100
})

function countByStatus(status: string): number {
  return statsRows.value.filter((row) => String(row.status) === status).length
}

function isBlank(value: unknown): boolean {
  return String(value ?? '').trim() === ''
}

function isIncomplete(sheet: EntryRow): boolean {
  return isBlank(sheet['发票号']) || isBlank(sheet['结算日期'])
}

function flash(result: ActionResult) {
  if (result.ok) {
    noticeMessage.value = result.message
    errorMessage.value = ''
  } else {
    errorMessage.value = result.message
    noticeMessage.value = ''
  }
}

function toggleCreate() {
  showCreate.value = !showCreate.value
}

function submitCreate() {
  const result = createProject({
    项目名称: createForm.value.项目名称,
    所属变电站: createForm.value.所属变电站,
    关联主变: createForm.value.关联主变,
    批复预算: Number(createForm.value.批复预算),
    立项日期: createForm.value.立项日期,
    负责人: createForm.value.负责人,
  })
  flash(result)
  if (result.ok) {
    showCreate.value = false
    createForm.value = { 项目名称: '', 所属变电站: '', 关联主变: '', 批复预算: '', 立项日期: '', 负责人: '' }
    reload()
  }
}

function runTransition(action: string, row: EntryRow) {
  flash(runTechrenovAction(Number(row.id), action))
  reload()
}

function openSettle(row: EntryRow) {
  selectedProject.value = row
  expenseForm.value = { 费用名称: '', 发票号: '', 结算金额: '', 结算日期: '', 提交人: store.operator }
  loadSettles()
}

function closeSettle() {
  selectedProject.value = null
  settleRows.value = []
}

function loadSettles() {
  if (!selectedProject.value) {
    return
  }
  settleRows.value = listSettlements(String(selectedProject.value['项目编号']))
  const forms: Record<number, { 发票号: string; 结算日期: string }> = {}
  for (const sheet of settleRows.value) {
    forms[Number(sheet.id)] = { 发票号: '', 结算日期: '' }
  }
  patchForms.value = forms
}

function refreshSelected() {
  if (!selectedProject.value) {
    return
  }
  const fresh = listEntries(TECHRENOV_KEY).items.find(
    (row) => Number(row.id) === Number(selectedProject.value?.id),
  )
  if (fresh) {
    selectedProject.value = fresh
  }
}

function submitExpenseForm() {
  if (!selectedProject.value) {
    return
  }
  const result = submitExpense(Number(selectedProject.value.id), {
    费用名称: expenseForm.value.费用名称,
    发票号: expenseForm.value.发票号,
    结算金额: Number(expenseForm.value.结算金额),
    结算日期: expenseForm.value.结算日期,
    提交人: expenseForm.value.提交人,
  })
  flash(result)
  if (result.ok) {
    expenseForm.value = { ...expenseForm.value, 费用名称: '', 发票号: '', 结算金额: '', 结算日期: '' }
  }
  loadSettles()
  reload()
}

function patchRow(sheet: EntryRow) {
  const form = patchForms.value[Number(sheet.id)]
  flash(completeExpense(Number(sheet.id), form ?? { 发票号: '', 结算日期: '' }))
  loadSettles()
}

function startBudget(row: EntryRow) {
  budgetEditId.value = Number(row.id)
  budgetInput.value = String(row['批复预算(万元)'] ?? '')
}

function confirmBudget(row: EntryRow) {
  flash(adjustBudget(Number(row.id), Number(budgetInput.value)))
  budgetEditId.value = null
  reload()
}

function reconcile() {
  flash(reconcileBudgets())
  reload()
}

function exportRows() {
  downloadEntries(TECHRENOV_KEY)
}

function exportSettles() {
  if (selectedProject.value) {
    downloadSettlements(String(selectedProject.value['项目编号']))
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function reload() {
  try {
    const payload = listEntries(TECHRENOV_KEY, filters.value)
    rows.value = payload.items
    total.value = payload.total
    statsRows.value = listEntries(TECHRENOV_KEY).items
    refreshSelected()
    loadSettles()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '技改项目台账读取失败'
  }
}

onMounted(reload)
</script>
