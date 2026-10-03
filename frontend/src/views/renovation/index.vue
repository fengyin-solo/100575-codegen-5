<template>
  <section class="page" data-module="renovation">
    <header class="page-head">
      <div>
        <h2>保护技改项目立项与费用结算台账</h2>
        <p class="page-desc">
          一条项目从立项走到结算：状态只能按 立项→评审→实施→结算 依次流转，跳级拒收、已结算锁定；
          费用缺发票号/结算日期挡回，预算两处同步且以立项批复为准，结算结果自动进入主变检修待排期清单。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">立项登记</button>
        <button class="btn" type="button" @click="showSchedule = !showSchedule">
          {{ showSchedule ? '返回项目台账' : '查看主变检修待排期清单' }}
        </button>
        <button class="btn ghost" type="button" @click="resetSeed">恢复示例数据</button>
      </div>
    </header>

    <!-- 待排期清单：结算完成的项目自动落到这里 -->
    <div v-if="showSchedule">
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">待排期条目</span>
          <strong class="stat-value">{{ schedule.length }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">涉及结算金额（元）</span>
          <strong class="stat-value">{{ formatYuan(scheduleBudget) }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">来源</span>
          <strong class="stat-value">技改结算自动推送</strong>
        </article>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>检修编号</th><th>来源技改项目</th><th>变电站</th><th>主变名称</th>
            <th>检修类别</th><th>停电范围</th><th>结算金额（元）</th><th>结算日期</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in schedule" :key="item.id">
            <td>{{ item.maintenanceNo }}</td>
            <td>{{ item.sourceProjectCode }}</td>
            <td>{{ item.substation }}</td>
            <td>{{ item.mainTransformer }}</td>
            <td>{{ item.category }}</td>
            <td>{{ item.outageScope }}</td>
            <td>{{ formatYuan(item.budgetCents) }}</td>
            <td>{{ item.settledAt }}</td>
          </tr>
          <tr v-if="!schedule.length">
            <td colspan="8" class="empty-state">暂无待排期条目，项目完成结算后会自动进入此清单</td>
          </tr>
        </tbody>
      </table>
      <p class="page-foot">说明：结算完成时推送一次，重复结算不会重复排期。</p>
    </div>

    <!-- 项目台账 -->
    <div v-else>
      <div class="stat-row">
        <article v-for="card in statsCards" :key="card.label" class="stat-card">
          <span class="stat-label">{{ card.label }}</span>
          <strong class="stat-value">{{ card.value }}</strong>
        </article>
      </div>

      <form class="filter-bar" @submit.prevent="reload">
        <label class="filter-item">
          <span>项目编号/名称</span>
          <input v-model="keyword" placeholder="按编号或名称检索" />
        </label>
        <label class="filter-item">
          <span>状态</span>
          <select v-model="statusFilter">
            <option value="">全部</option>
            <option v-for="s in STATUSES" :key="s" :value="s">{{ s }}</option>
          </select>
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th>项目编号</th><th>项目名称</th><th>变电站</th><th>责任部门</th>
            <th>项目经理</th><th>立项预算（元）</th><th>已发生（元）</th><th>剩余预算（元）</th>
            <th>当前卡在</th><th>状态</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in filtered" :key="row.id" :class="{ locked: row.status === '结算' }">
            <td>{{ row.code }}</td>
            <td>{{ row.name }}</td>
            <td>{{ row.substation }}</td>
            <td>{{ row.ownerDept }}</td>
            <td>{{ row.manager }}</td>
            <td>{{ formatYuan(row.approvedBudgetCents) }}</td>
            <td>{{ formatYuan(spentCents(row)) }}</td>
            <td :class="remainingCents(row) < 0 ? 'over-budget' : ''">
              {{ formatYuan(remainingCents(row)) }}
            </td>
            <td>{{ currentHandler(row) }}</td>
            <td><span class="status-pill" :class="`s-${row.status}`">{{ row.status }}</span></td>
            <td class="row-actions">
              <button class="link" type="button" @click="openDetail(row.id)">
                {{ row.status === '结算' ? '查看结算单' : '办理' }}
              </button>
            </td>
          </tr>
          <tr v-if="!filtered.length">
            <td colspan="11" class="empty-state">暂无符合条件的项目，可先做立项登记</td>
          </tr>
        </tbody>
      </table>

      <footer class="page-foot">
        <span v-if="flash" class="error-text">{{ flash }}</span>
        <span>预算口径：台账与结算单两处同步，冲突时以批复的立项预算为准。</span>
      </footer>
    </div>

    <!-- 立项登记弹层 -->
    <div v-if="creating" class="modal-mask" @click.self="creating = false">
      <div class="modal">
        <h3>立项登记</h3>
        <p class="page-desc">立项批复后登记，预算金额按批复数填写；项目初始状态为「立项」。</p>
        <div class="form-grid">
          <label><span>项目编号 *</span><input v-model="createForm.code" placeholder="如 JG-2026-005" /></label>
          <label><span>项目名称 *</span><input v-model="createForm.name" /></label>
          <label><span>所属变电站 *</span><input v-model="createForm.substation" /></label>
          <label><span>责任部门 *</span><input v-model="createForm.ownerDept" /></label>
          <label><span>项目经理 *</span><input v-model="createForm.manager" /></label>
          <label>
            <span>批复立项预算（元）*</span>
            <input v-model="createForm.budgetRaw" placeholder="如 250000 或 250000.00" />
          </label>
        </div>
        <p v-if="createError" class="error-text">{{ createError }}</p>
        <div class="modal-foot">
          <button class="btn" type="button" @click="creating = false">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">提交立项</button>
        </div>
      </div>
    </div>

    <!-- 项目办理抽屉 -->
    <div v-if="detail" class="drawer-mask" @click.self="detail = null">
      <div class="drawer">
        <header class="drawer-head">
          <div>
            <h3>{{ detail.code }}｜{{ detail.name }}</h3>
            <p class="page-desc">{{ detail.substation }} · {{ detail.ownerDept }} · 项目经理 {{ detail.manager }}</p>
          </div>
          <button class="btn" type="button" @click="detail = null">关闭</button>
        </header>

        <!-- 状态流水线 -->
        <ol class="pipeline">
          <li
            v-for="(s, idx) in STATUSES"
            :key="s"
            :class="{
              done: rank(s) < rank(detail.status),
              active: s === detail.status,
              lock: s === '结算' && detail.status === '结算',
            }"
          >
            <span class="dot">{{ idx + 1 }}</span>
            <span class="label">{{ s }}</span>
            <span v-if="s === '结算' && detail.status === '结算'" class="lock-text">已锁定</span>
          </li>
        </ol>

        <div v-if="detailError" class="alert error">{{ detailError }}</div>
        <div v-if="detailOk" class="alert ok">{{ detailOk }}</div>

        <!-- 预算卡：始终以立项批复为准 -->
        <div class="budget-row">
          <div class="budget-card">
            <span class="stat-label">批复立项预算（元）</span>
            <strong>{{ formatYuan(detail.approvedBudgetCents) }}</strong>
          </div>
          <div class="budget-card">
            <span class="stat-label">已发生费用（元）</span>
            <strong>{{ formatYuan(spentCents(detail)) }}</strong>
          </div>
          <div class="budget-card">
            <span class="stat-label">剩余预算（元）</span>
            <strong :class="remainingCents(detail) < 0 ? 'over-budget' : ''">
              {{ formatYuan(remainingCents(detail)) }}
            </strong>
          </div>
          <div class="budget-card">
            <span class="stat-label">当前办理人</span>
            <strong>{{ currentHandler(detail) }}</strong>
          </div>
        </div>

        <!-- 流转动作 -->
        <div v-if="detail.status !== '结算'" class="action-bar">
          <button
            v-if="detail.status === '立项'"
            class="btn primary"
            type="button"
            @click="doAdvance('评审')"
          >送评审</button>
          <button
            v-if="detail.status === '评审'"
            class="btn primary"
            type="button"
            @click="doAdvance('实施')"
          >批复实施</button>
          <button class="btn" type="button" @click="trySkip">演示：跳级/回退会怎样</button>
          <span class="page-desc">只能点当前阶段的下一步；「完成结算」在下方结算单里提交。</span>
        </div>
        <div v-else class="alert ok">
          项目已于 {{ detail.settledAt }} 完成结算（结算单号 {{ detail.settlementNo }}），
          已同步至主变检修待排期清单（{{ detail.maintenanceRef }}）。台账锁定，不允许回退改数。
        </div>

        <!-- 费用明细：仅实施阶段可登记 -->
        <section class="block">
          <h4>费用结算明细</h4>
          <table class="data-table inner">
            <thead>
              <tr><th>费用摘要</th><th>金额（元）</th><th>发票号</th><th>结算日期</th><th>办理人</th></tr>
            </thead>
            <tbody>
              <tr v-for="item in detail.expenses" :key="item.id">
                <td>{{ item.title }}</td>
                <td>{{ formatYuan(item.amountCents) }}</td>
                <td>{{ item.invoiceNo }}</td>
                <td>{{ item.settledAt }}</td>
                <td>{{ item.handler }}</td>
              </tr>
              <tr v-if="!detail.expenses.length">
                <td colspan="5" class="empty-state">尚无费用</td>
              </tr>
            </tbody>
          </table>

          <form v-if="detail.status === '实施'" class="form-grid expense-form" @submit.prevent="submitExpense">
            <label><span>费用摘要 *</span><input v-model="expenseForm.title" placeholder="如 保护装置采购" /></label>
            <label><span>金额（元）*</span><input v-model="expenseForm.amountRaw" placeholder="如 120000" /></label>
            <label><span>发票号 *</span><input v-model="expenseForm.invoiceNo" placeholder="重复发票号只算一次" /></label>
            <label><span>结算日期 *</span><input v-model="expenseForm.settledAt" placeholder="YYYY-MM-DD" /></label>
            <label><span>办理人 *</span><input v-model="expenseForm.handler" /></label>
            <div class="form-submit">
              <button class="btn primary" type="submit">登记费用</button>
            </div>
          </form>
          <p v-else-if="detail.status !== '结算'" class="page-desc">
            费用仅在「实施」阶段登记，当前为「{{ detail.status }}」。
          </p>
        </section>

        <!-- 结算单：实施阶段可提交 -->
        <section v-if="detail.status === '实施'" class="block">
          <h4>结算单提交</h4>
          <div class="form-grid">
            <label>
              <span>结算单预算（元）*</span>
              <input v-model="settleForm.settlementBudgetRaw" placeholder="须与立项预算一致" />
              <small class="page-desc">立项预算为 {{ formatYuan(detail.approvedBudgetCents) }} 元，不一致将被挡回。</small>
            </label>
            <label><span>主变名称 *</span><input v-model="settleForm.mainTransformer" placeholder="如 1 号主变" /></label>
            <label><span>检修类别 *</span><input v-model="settleForm.category" placeholder="如 保护改造后停电检修" /></label>
            <label><span>停电范围 *</span><input v-model="settleForm.outageScope" /></label>
            <label><span>结算办理人 *</span><input v-model="settleForm.handler" /></label>
          </div>
          <div class="form-submit">
            <button class="btn primary" type="button" @click="submitSettle">完成结算并推送待排期</button>
          </div>
        </section>

        <!-- 流转日志 -->
        <section class="block">
          <h4>流转记录</h4>
          <ul class="log-list">
            <li v-for="(log, i) in [...detail.logs].reverse()" :key="i">
              <span class="log-at">{{ log.at }}</span>{{ log.message }}
            </li>
          </ul>
        </section>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'

import {
  currentHandler,
  formatYuan,
  remainingCents,
  spentCents,
  useRenovationLedger,
} from '@/data/renovation/use-ledger'
import type { ProjectStatus, RenovationProject } from '@/data/renovation/types'

const STATUSES: ProjectStatus[] = ['立项', '评审', '实施', '结算']
const rank = (s: ProjectStatus): number => STATUSES.indexOf(s)

const ledger = useRenovationLedger()
const keyword = ref('')
const statusFilter = ref('')
const flash = ref('')
const showSchedule = ref(false)

const projects = ledger.projects
const schedule = ledger.maintenanceSchedule
const scheduleBudget = computed(() =>
  schedule.value.reduce((sum, item) => sum + item.budgetCents, 0),
)

const filtered = computed(() =>
  projects.value.filter((p) => {
    const kw = keyword.value.trim()
    const matchKw =
      !kw || p.code.includes(kw) || p.name.includes(kw) || p.substation.includes(kw)
    const matchStatus = !statusFilter.value || p.status === statusFilter.value
    return matchKw && matchStatus
  }),
)

const statsCards = computed(() => [
  { label: '项目总数', value: projects.value.length },
  { label: '立项中', value: projects.value.filter((p) => p.status === '立项').length },
  { label: '评审中', value: projects.value.filter((p) => p.status === '评审').length },
  { label: '实施中', value: projects.value.filter((p) => p.status === '实施').length },
  { label: '已结算（锁定）', value: projects.value.filter((p) => p.status === '结算').length },
])

function reload() {
  flash.value = ''
}
function resetFilters() {
  keyword.value = ''
  statusFilter.value = ''
}
function resetSeed() {
  ledger.resetToSeed()
  flash.value = '已恢复示例数据'
}

// ---- 立项 ----
const creating = ref(false)
const createError = ref('')
const createForm = reactive({
  code: '',
  name: '',
  substation: '',
  ownerDept: '',
  manager: '',
  budgetRaw: '',
})

function openCreate() {
  createError.value = ''
  creating.value = true
}

function submitCreate() {
  const result = ledger.create({ ...createForm })
  if (!result.ok) {
    createError.value = result.message
    return
  }
  creating.value = false
  Object.assign(createForm, {
    code: '',
    name: '',
    substation: '',
    ownerDept: '',
    manager: '',
    budgetRaw: '',
  })
  flash.value = result.message
}

// ---- 项目抽屉 ----
const detailId = ref<number | null>(null)
const detail = computed<RenovationProject | null>(() =>
  detailId.value === null ? null : ledger.projectById(detailId.value) ?? null,
)
const detailError = ref('')
const detailOk = ref('')

function openDetail(id: number) {
  detailId.value = id
  detailError.value = ''
  detailOk.value = ''
  const project = ledger.projectById(id)
  if (project && project.settlementBudgetCents === null) {
    settleForm.settlementBudgetRaw = (project.approvedBudgetCents / 100).toString()
  } else if (project) {
    settleForm.settlementBudgetRaw = ((project.settlementBudgetCents ?? 0) / 100).toString()
  }
}

function doAdvance(target: ProjectStatus) {
  if (detailId.value === null) return
  const result = ledger.moveTo(detailId.value, target)
  if (!result.ok) {
    detailOk.value = ''
    detailError.value = result.message
    return
  }
  detailError.value = ''
  detailOk.value = result.message
}

// 演示用：尝试从当前阶段跳到结算，让拒收规则直接可见。
function trySkip() {
  doAdvance('结算')
}

// ---- 费用 ----
const expenseForm = reactive({
  title: '',
  amountRaw: '',
  invoiceNo: '',
  settledAt: '',
  handler: '',
})

function resetExpenseForm() {
  Object.assign(expenseForm, {
    title: '',
    amountRaw: '',
    invoiceNo: '',
    settledAt: '',
    handler: '',
  })
}

function submitExpense() {
  if (detailId.value === null) return
  const result = ledger.addExpense(detailId.value, { ...expenseForm })
  if (!result.ok) {
    detailOk.value = ''
    detailError.value = result.message
    return
  }
  detailError.value = ''
  detailOk.value = result.message
  resetExpenseForm()
}

// ---- 结算 ----
const settleForm = reactive({
  settlementBudgetRaw: '',
  mainTransformer: '',
  category: '',
  outageScope: '',
  handler: '',
})

function submitSettle() {
  if (detailId.value === null) return
  const result = ledger.settle(detailId.value, { ...settleForm })
  if (!result.ok) {
    detailOk.value = ''
    detailError.value = result.message
    return
  }
  detailError.value = ''
  detailOk.value = result.message
}
</script>

<style scoped>
.status-pill {
  display: inline-block;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  background: #eef2f7;
}
.s-立项 { background: #e0e7ff; color: #3730a3; }
.s-评审 { background: #fef3c7; color: #92400e; }
.s-实施 { background: #dbeafe; color: #1e40af; }
.s-结算 { background: #dcfce7; color: #166534; }
tr.locked { background: #f8fafc; }
.over-budget { color: #b42318; font-weight: 600; }

.modal-mask,
.drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  z-index: 20;
  display: flex;
}
.modal {
  margin: auto;
  width: 720px;
  max-width: calc(100vw - 40px);
  background: #fff;
  border-radius: 10px;
  padding: 20px;
}
.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}
.drawer {
  margin-left: auto;
  width: 860px;
  max-width: calc(100vw - 40px);
  height: 100%;
  overflow-y: auto;
  background: #f6f8fb;
  padding: 18px 20px 40px;
}
.drawer-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 14px;
  margin-top: 10px;
}
.form-grid label span {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 2px;
}
.form-grid input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.form-submit {
  margin-top: 10px;
}
.expense-form {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.pipeline {
  display: flex;
  list-style: none;
  padding: 0;
  margin: 14px 0;
  gap: 0;
}
.pipeline li {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  position: relative;
}
.pipeline li:not(:last-child)::after {
  content: '';
  flex: 1;
  height: 2px;
  background: var(--border);
  margin: 0 8px;
}
.pipeline li.done::after,
.pipeline li.active::after {
  background: var(--brand);
}
.pipeline .dot {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 1px solid var(--border);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  background: #fff;
}
.pipeline li.done,
.pipeline li.active {
  color: var(--brand);
  font-weight: 600;
}
.pipeline li.done .dot,
.pipeline li.active .dot {
  background: var(--brand);
  color: #fff;
  border-color: var(--brand);
}
.pipeline li.lock .dot {
  background: #166534;
  border-color: #166534;
  color: #fff;
}
.lock-text {
  font-size: 12px;
  color: #166534;
}

.alert {
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 13px;
  margin: 8px 0;
}
.alert.error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #b42318;
}
.alert.ok {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #166534;
}

.budget-row {
  display: flex;
  gap: 10px;
  margin: 10px 0;
}
.budget-card {
  flex: 1;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
}
.budget-card strong {
  display: block;
  margin-top: 4px;
  font-size: 17px;
}
.action-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 0;
}
.block {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  margin-top: 12px;
}
.block h4 {
  margin: 0 0 8px;
}
.data-table.inner {
  margin-bottom: 8px;
}
.log-list {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 13px;
}
.log-list li {
  padding: 4px 0;
  border-bottom: 1px dashed var(--border);
}
.log-at {
  display: inline-block;
  width: 100px;
  color: var(--muted);
}
select {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
</style>
