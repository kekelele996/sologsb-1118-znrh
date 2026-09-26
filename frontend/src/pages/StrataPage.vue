<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Inclusion, Stratum, UnitType } from '@/types'
import { INCLUSIONS, UNIT_TYPES, isCodeDuplicated, isDepthInverted, stratumThickness } from '@/types'
import StratumDepthBar from '@/components/common/StratumDepthBar.vue'
import TrenchTag from '@/components/common/TrenchTag.vue'
import { useStore } from '@/hooks/usePersistentStore'
import { useStratumOrder } from '@/hooks/useStratumOrder'
import { stratumStore } from '@/stores/stratumStore'
import { trenchStore } from '@/stores/trenchStore'
import { artifactStore } from '@/stores/artifactStore'
import { relationStore } from '@/stores/relationStore'
import { uid } from '@/utils/id'
import { buildDepthShiftPreview, type ArtifactShiftRow, type DepthShiftPreview, type RelationConflict, type StratumShiftRow } from '@/utils/depthShift'

const trenchState = useStore(trenchStore)
const stratumState = useStore(stratumStore)
const artifactState = useStore(artifactStore)
const relationState = useStore(relationStore)

const { result: order } = useStratumOrder(
  computed(() => stratumState.strata),
  computed(() => relationState.relations)
)

const filterTrenchId = ref('')
const filterType = ref<UnitType | ''>('')
const depthFrom = ref<number | undefined>(undefined)
const depthTo = ref<number | undefined>(undefined)
const selectedIds = ref<string[]>([])
const batchType = ref<UnitType>('地层')

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)

const form = reactive({
  trenchId: '',
  code: '',
  type: '地层' as UnitType,
  openLayer: '第①层',
  topDepth: 0,
  bottomDepth: 0.3,
  soil: '',
  inclusions: [] as Inclusion[],
  formation: '',
  date: new Date().toISOString().slice(0, 10),
  drawingNo: ''
})

const visible = computed(() =>
  stratumState.strata.filter((item) => {
    if (filterTrenchId.value && item.trenchId !== filterTrenchId.value) return false
    if (filterType.value && item.type !== filterType.value) return false
    if (depthFrom.value !== undefined && item.bottomDepth < depthFrom.value) return false
    if (depthTo.value !== undefined && item.topDepth > depthTo.value) return false
    return true
  })
)

function trenchLabel(trenchId: string): string {
  const trench = trenchState.trenches.find((item) => item.id === trenchId)
  return trench ? `${trench.area} · ${trench.code}` : '未知探方'
}

function artifactsOf(stratumId: string): number {
  return artifactState.artifacts.filter((item) => item.stratumId === stratumId).reduce((sum, item) => sum + item.count, 0)
}

function invertedOf(stratum: Stratum): boolean {
  return isDepthInverted(stratum)
}

function duplicatedOf(stratum: Stratum): boolean {
  return isCodeDuplicated(stratumState.strata, stratum)
}

function rowClass(param: { row: Stratum }): string {
  if (invertedOf(param.row)) return 'inverted-row'
  if (duplicatedOf(param.row)) return 'duplicate-row'
  return ''
}

/** 与层位关系矛盾的告警（按单位过滤） */
const conflictOf = (code: string): string | null =>
  order.value.conflicts.find((item) => item.startsWith(code)) ?? null

watch(
  () => [trenchState.trenches.length, form.trenchId] as const,
  () => {
    if (!form.trenchId && trenchState.trenches.length > 0) form.trenchId = trenchState.trenches[0].id
  },
  { immediate: true }
)

function resetForm(): void {
  editingId.value = null
  form.trenchId = trenchState.trenches[0]?.id ?? ''
  form.code = ''
  form.type = '地层'
  form.openLayer = '第①层'
  form.topDepth = 0
  form.bottomDepth = 0.3
  form.soil = ''
  form.inclusions = []
  form.formation = ''
  form.date = new Date().toISOString().slice(0, 10)
  form.drawingNo = ''
}

function openCreate(): void {
  resetForm()
  dialogVisible.value = true
}

function openEdit(stratum: Stratum): void {
  editingId.value = stratum.id
  Object.assign(form, {
    trenchId: stratum.trenchId,
    code: stratum.code,
    type: stratum.type,
    openLayer: stratum.openLayer,
    topDepth: stratum.topDepth,
    bottomDepth: stratum.bottomDepth,
    soil: stratum.soil,
    inclusions: [...stratum.inclusions],
    formation: stratum.formation,
    date: stratum.date,
    drawingNo: stratum.drawingNo
  })
  dialogVisible.value = true
}

async function submit(): Promise<void> {
  if (!form.trenchId) {
    ElMessage.warning('请选择所属探方')
    return
  }
  if (!form.code.trim()) {
    ElMessage.warning('请填写单位号（如 H12、L03）')
    return
  }
  if (form.topDepth < 0 || form.bottomDepth < 0) {
    ElMessage.warning('深度不能为负值')
    return
  }
  const candidate = { id: editingId.value ?? uid('st'), trenchId: form.trenchId, code: form.code.trim().toUpperCase() }
  if (isCodeDuplicated(stratumState.strata, candidate)) {
    ElMessage.error(`同一探方内单位号「${candidate.code}」已存在，请更换`)
    return
  }
  const row: Stratum = {
    id: candidate.id,
    trenchId: candidate.trenchId,
    code: candidate.code,
    type: form.type,
    openLayer: form.openLayer.trim(),
    topDepth: Number(form.topDepth) || 0,
    bottomDepth: Number(form.bottomDepth) || 0,
    soil: form.soil.trim(),
    inclusions: [...form.inclusions],
    formation: form.formation.trim(),
    date: form.date,
    drawingNo: form.drawingNo.trim()
  }
  await stratumStore.getState().save(row)
  if (isDepthInverted(row)) {
    ElMessage.warning(`已保存，但「${row.code}」上界深度大于下界，层序倒置需复核`)
  } else {
    ElMessage.success(`地层单位 ${row.code} 已保存（厚 ${stratumThickness(row)} m）`)
  }
  dialogVisible.value = false
}

async function remove(stratum: Stratum): Promise<void> {
  const count = artifactState.artifacts.filter((item) => item.stratumId === stratum.id).length
  const relations = relationState.relations.filter(
    (item) => item.unitAId === stratum.id || item.unitBId === stratum.id
  ).length
  if (count > 0 || relations > 0) {
    ElMessage.error(`「${stratum.code}」下仍有 ${count} 件出土物、${relations} 条层位关系，请先清理`)
    return
  }
  await ElMessageBox.confirm(`确认删除地层单位「${stratum.code}」？`, '删除确认', { type: 'warning' })
  await stratumStore.getState().remove(stratum.id)
  ElMessage.success('地层单位已删除')
}

async function applyBatchType(): Promise<void> {
  if (selectedIds.value.length === 0) {
    ElMessage.warning('请先勾选要调整的单位')
    return
  }
  await stratumStore.getState().bulkSetType(selectedIds.value, batchType.value)
  ElMessage.success(`已把 ${selectedIds.value.length} 个单位的类型调整为「${batchType.value}」`)
}

/* —— 按探方整体校正深度 —— */

const shiftDialogVisible = ref(false)
const shiftTrenchId = ref('')
const shiftDelta = ref(0)

const shiftPreview = computed<DepthShiftPreview | null>(() => {
  if (!shiftDialogVisible.value || !shiftTrenchId.value) return null
  return buildDepthShiftPreview(
    shiftTrenchId.value,
    Number(shiftDelta.value) || 0,
    stratumState.strata,
    artifactState.artifacts,
    relationState.relations
  )
})

const shiftCanApply = computed(
  () =>
    shiftPreview.value !== null &&
    shiftPreview.value.stratumRows.length > 0 &&
    !shiftPreview.value.blocked &&
    (Number(shiftDelta.value) || 0) !== 0
)

function openShiftDialog(): void {
  if (trenchState.trenches.length === 0) {
    ElMessage.warning('请先登记探方，再进行深度校正')
    return
  }
  shiftTrenchId.value = filterTrenchId.value || trenchState.trenches[0].id
  shiftDelta.value = 0
  shiftDialogVisible.value = true
}

function stratumCodeById(id: string): string {
  return stratumState.strata.find((item) => item.id === id)?.code ?? '未知单位'
}

function surfaceText(rows: StratumShiftRow[]): string {
  return rows
    .map((row) => `${row.stratum.code}（上界 ${row.newTopDepth} m、下界 ${row.newBottomDepth} m）`)
    .join('；')
}

function artifactSurfaceText(rows: ArtifactShiftRow[]): string {
  return rows.map((row) => `${row.artifact.code}（Z ${row.newZ} m）`).join('；')
}

function conflictText(conflict: RelationConflict): string {
  const shiftedLabel = trenchLabel(conflict.shiftedStratum.trenchId)
  const otherLabel = trenchLabel(conflict.otherStratum.trenchId)
  return `${conflict.shiftedStratum.code}（${shiftedLabel}）${conflict.relation.type} ${conflict.otherStratum.code}（${otherLabel}）：校正后 ${conflict.shiftedStratum.code} 上界将深于 ${conflict.otherStratum.code}`
}

async function confirmShift(): Promise<void> {
  const preview = shiftPreview.value
  if (!preview || !shiftCanApply.value) return
  await ElMessageBox.confirm(
    `将把「${trenchLabel(preview.trenchId)}」整体${preview.delta > 0 ? '加深' : '上移'} ${Math.abs(
      preview.delta
    )} m：${preview.stratumRows.length} 个地层单位与 ${preview.artifactRows.length} 件出土物同步更新，其他探方和层位关系不变。确认执行？`,
    '执行校正确认',
    { type: 'warning', confirmButtonText: '确认执行', cancelButtonText: '再核对一下' }
  )
  const result = await stratumStore.getState().shiftTrenchDepths(preview.trenchId, preview.delta)
  await artifactStore.getState().hydrate()
  shiftDialogVisible.value = false
  ElMessage.success(`校正完成：${result.strata} 个地层单位、${result.artifacts} 件出土物的深度已同步更新`)
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">地层单位编目表</h2>
        <p class="page-sub">
          按类型与深度区间筛选；层序倒置（上界大于下界）与同一探方内单位号重复即时高亮提示，深度刻度条展示厚度。
        </p>
      </div>
      <div class="head-actions">
        <el-button plain @click="openShiftDialog">
          <el-icon><ScaleToOriginal /></el-icon>按探方校正深度
        </el-button>
        <el-button type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>新建地层单位
        </el-button>
      </div>
    </div>

    <el-alert
      v-if="order.inverted.length > 0 || order.duplicateCodes.length > 0"
      class="alert"
      type="warning"
      :closable="false"
      show-icon
      :title="`发现 ${order.inverted.length} 个层序倒置单位、${order.duplicateCodes.length} 个重复单位号`"
    >
      <template #default>
        <p v-if="order.inverted.length > 0">
          层序倒置：{{ order.inverted.map((item) => item.code).join('、') }}（上界深度大于下界深度）
        </p>
        <p v-if="order.duplicateCodes.length > 0">单位号重复：{{ order.duplicateCodes.join('、') }}</p>
        <p v-if="order.conflicts.length > 0">
          与层位关系矛盾：{{ order.conflicts.join('；') }}
        </p>
      </template>
    </el-alert>
    <el-alert
      v-else
      class="alert"
      type="success"
      :closable="false"
      show-icon
      title="层序与单位号校验通过"
    />

    <div class="toolbar">
      <el-select v-model="filterTrenchId" placeholder="全部探方" clearable style="width: 190px">
        <el-option v-for="trench in trenchState.trenches" :key="trench.id" :label="`${trench.area} · ${trench.code}`" :value="trench.id" />
      </el-select>
      <el-select v-model="filterType" placeholder="全部类型" clearable style="width: 130px">
        <el-option v-for="type in UNIT_TYPES" :key="type" :label="type" :value="type" />
      </el-select>
      <div class="depth">
        <span class="muted">深度区间（米）</span>
        <el-input-number v-model="depthFrom" :min="0" :step="0.1" :controls="false" placeholder="起" style="width: 100px" />
        <span>—</span>
        <el-input-number v-model="depthTo" :min="0" :step="0.1" :controls="false" placeholder="止" style="width: 100px" />
      </div>
      <el-select v-model="batchType" style="width: 130px">
        <el-option v-for="type in UNIT_TYPES" :key="type" :label="type" :value="type" />
      </el-select>
      <el-button type="primary" plain @click="applyBatchType">批量调整类型</el-button>
      <el-tag type="info" effect="plain">命中 {{ visible.length }} / {{ stratumState.strata.length }} 个单位</el-tag>
    </div>

    <el-table
      :data="visible"
      border
      stripe
      row-key="id"
      :row-class-name="rowClass"
      @selection-change="(rows: Stratum[]) => (selectedIds = rows.map((row) => row.id))"
    >
      <el-table-column type="selection" width="46" />
      <el-table-column label="序号" width="70">
        <template #default="{ row }: { row: Stratum }">{{ order.indexOf.get(row.id) ?? '—' }}</template>
      </el-table-column>
      <el-table-column label="探方" width="150">
        <template #default="{ row }: { row: Stratum }">
          <span class="mono">{{ trenchLabel(row.trenchId) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="单位号" width="110">
        <template #default="{ row }: { row: Stratum }">
          <span class="mono">{{ row.code }}</span>
          <el-tag v-if="duplicatedOf(row)" type="warning" size="small" effect="dark" class="mini">重复</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="类型" width="120">
        <template #default="{ row }: { row: Stratum }">
          <TrenchTag :unit-type="row.type" size="small" />
        </template>
      </el-table-column>
      <el-table-column label="深度刻度" width="250">
        <template #default="{ row }: { row: Stratum }">
          <StratumDepthBar :stratum="row" :length="180" />
        </template>
      </el-table-column>
      <el-table-column label="开口层位" width="110" prop="openLayer" />
      <el-table-column label="土质土色" min-width="150" prop="soil" show-overflow-tooltip />
      <el-table-column label="包含物" width="150">
        <template #default="{ row }: { row: Stratum }">
          <el-tag v-for="item in row.inclusions" :key="item" size="small" effect="plain" class="mini">{{ item }}</el-tag>
          <span v-if="row.inclusions.length === 0" class="muted">—</span>
        </template>
      </el-table-column>
      <el-table-column label="出土物" width="90">
        <template #default="{ row }: { row: Stratum }">{{ artifactsOf(row.id) }} 件</template>
      </el-table-column>
      <el-table-column label="校验" width="110">
        <template #default="{ row }: { row: Stratum }">
          <el-tag v-if="invertedOf(row)" type="danger" size="small" effect="dark">层序倒置</el-tag>
          <el-tag v-else-if="conflictOf(row.code)" type="warning" size="small" effect="dark">关系矛盾</el-tag>
          <el-tag v-else type="success" size="small" effect="plain">正常</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="130" fixed="right">
        <template #default="{ row }: { row: Stratum }">
          <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑地层单位' : '新建地层单位'" width="680px">
      <el-form label-width="110px">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="所属探方" required>
              <el-select v-model="form.trenchId" style="width: 100%">
                <el-option v-for="trench in trenchState.trenches" :key="trench.id" :label="`${trench.area} · ${trench.code}`" :value="trench.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="单位号" required>
              <el-input v-model="form.code" placeholder="如 H12、L03" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="单位类型">
              <el-select v-model="form.type" style="width: 100%">
                <el-option v-for="type in UNIT_TYPES" :key="type" :label="type" :value="type" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="开口层位">
              <el-input v-model="form.openLayer" placeholder="如 第②层下" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="上界深度(m)">
              <el-input-number v-model="form.topDepth" :min="0" :step="0.05" :precision="2" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="下界深度(m)">
              <el-input-number v-model="form.bottomDepth" :min="0" :step="0.05" :precision="2" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="厚度">
              <el-input :model-value="`${Math.abs(form.bottomDepth - form.topDepth).toFixed(2)} m`" disabled />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="土质土色">
          <el-input v-model="form.soil" placeholder="如 灰褐色砂质黏土，疏松" />
        </el-form-item>
        <el-form-item label="包含物">
          <el-checkbox-group v-model="form.inclusions">
            <el-checkbox v-for="item in INCLUSIONS" :key="item" :value="item">{{ item }}</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="堆积成因">
          <el-input v-model="form.formation" placeholder="如 生活垃圾坑" />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="发掘日期">
              <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="绘图/拍照号">
              <el-input v-model="form.drawingNo" placeholder="如 T0501-北壁-02" />
            </el-form-item>
          </el-col>
        </el-row>
        <p v-if="form.topDepth > form.bottomDepth" class="warn">上界深度大于下界深度，保存后将标记为「层序倒置」</p>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="shiftDialogVisible" title="按探方整体校正地层深度" width="860px">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="更换工地水准点后使用：选中探方的全部地层单位与其下出土物按同一平移量更新深度。"
        description="平移量为正表示整体加深、为负表示上移；先试算确认调整后的深度范围与受影响出土物，再执行。任何深度不得低于地表；若会造成跨探方层位关系矛盾则拒绝执行。"
        class="alert"
      />
      <el-form label-width="110px" class="shift-form">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="选择探方" required>
              <el-select v-model="shiftTrenchId" style="width: 100%">
                <el-option
                  v-for="trench in trenchState.trenches"
                  :key="trench.id"
                  :label="`${trench.area} · ${trench.code}`"
                  :value="trench.id"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="深度平移量(m)" required>
              <el-input-number
                v-model="shiftDelta"
                :step="0.05"
                :precision="2"
                :controls="false"
                style="width: 100%"
                placeholder="正数加深，负数上移"
              />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>

      <template v-if="shiftPreview">
        <el-alert
          v-if="shiftPreview.stratumRows.length === 0"
          type="warning"
          :closable="false"
          show-icon
          class="alert"
          title="该探方下还没有地层单位，无可校正的深度"
        />
        <el-alert
          v-else-if="shiftPreview.surfaceViolations.length > 0"
          type="error"
          :closable="false"
          show-icon
          class="alert"
          title="校正被拒绝：以下地层单位调整后深度将低于地表（0 m）"
        >
          <span>{{ surfaceText(shiftPreview.surfaceViolations) }}</span>
        </el-alert>
        <el-alert
          v-if="shiftPreview.artifactSurfaceViolations.length > 0"
          type="error"
          :closable="false"
          show-icon
          class="alert"
          title="校正被拒绝：以下出土物调整后出土深度将低于地表（0 m）"
        >
          <span>{{ artifactSurfaceText(shiftPreview.artifactSurfaceViolations) }}</span>
        </el-alert>
        <el-alert
          v-if="shiftPreview.relationConflicts.length > 0"
          type="error"
          :closable="false"
          show-icon
          class="alert"
          title="校正被拒绝：将造成跨探方层位关系矛盾，请先处理下列冲突记录"
        >
          <div v-for="(conflict, index) in shiftPreview.relationConflicts" :key="conflict.relation.id">
            {{ index + 1 }}. 关系记录「{{ stratumCodeById(conflict.relation.unitAId) }} {{ conflict.relation.type }}
            {{ stratumCodeById(conflict.relation.unitBId) }}」——{{ conflictText(conflict) }}
          </div>
        </el-alert>
        <el-alert
          v-else-if="shiftPreview.delta === 0"
          type="warning"
          :closable="false"
          show-icon
          class="alert"
          title="请填写非零的深度平移量"
        />
        <el-alert
          v-else
          type="success"
          :closable="false"
          show-icon
          class="alert"
          :title="`试算通过：${shiftPreview.stratumRows.length} 个地层单位、${shiftPreview.artifactRows.length} 件出土物将同步更新，其他探方和层位关系不变`"
        />

        <h4 class="shift-section">调整后的深度范围（{{ shiftPreview.stratumRows.length }} 个单位）</h4>
        <el-table :data="shiftPreview.stratumRows" border stripe size="small" max-height="240" row-key="stratum.id">
          <el-table-column label="单位号" width="100">
            <template #default="{ row }: { row: StratumShiftRow }">
              <span class="mono">{{ row.stratum.code }}</span>
            </template>
          </el-table-column>
          <el-table-column label="类型" width="90">
            <template #default="{ row }: { row: StratumShiftRow }">
              <TrenchTag :unit-type="row.stratum.type" size="small" />
            </template>
          </el-table-column>
          <el-table-column label="调整前深度(m)" width="150">
            <template #default="{ row }: { row: StratumShiftRow }">
              {{ row.stratum.topDepth.toFixed(2) }} – {{ row.stratum.bottomDepth.toFixed(2) }}
            </template>
          </el-table-column>
          <el-table-column label="调整后深度(m)" width="160">
            <template #default="{ row }: { row: StratumShiftRow }">
              <span :class="{ 'bad-depth': row.newTopDepth < 0 || row.newBottomDepth < 0 }">
                {{ row.newTopDepth.toFixed(2) }} – {{ row.newBottomDepth.toFixed(2) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="厚度(m)" width="100">
            <template #default="{ row }: { row: StratumShiftRow }">
              {{ stratumThickness(row.stratum).toFixed(2) }}
            </template>
          </el-table-column>
        </el-table>

        <h4 class="shift-section">受影响出土物（{{ shiftPreview.artifactRows.length }} 件，Z 深度同量平移）</h4>
        <el-table :data="shiftPreview.artifactRows" border stripe size="small" max-height="240" row-key="artifact.id">
          <el-table-column prop="artifact.code" label="器物编号" width="150" />
          <el-table-column label="所属单位" width="110">
            <template #default="{ row }: { row: ArtifactShiftRow }">
              <span class="mono">{{ row.stratum.code }}</span>
            </template>
          </el-table-column>
          <el-table-column label="调整前 Z(m)" width="120">
            <template #default="{ row }: { row: ArtifactShiftRow }">{{ row.artifact.z.toFixed(2) }}</template>
          </el-table-column>
          <el-table-column label="调整后 Z(m)" width="120">
            <template #default="{ row }: { row: ArtifactShiftRow }">
              <span :class="{ 'bad-depth': row.newZ < 0 }">{{ row.newZ.toFixed(2) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="artifact.category" label="类别" width="90" />
          <el-table-column prop="artifact.count" label="件数" width="70" />
        </el-table>
        <p v-if="shiftPreview.artifactRows.length === 0" class="muted shift-empty">该探方当前没有挂接地层单位的出土物。</p>
      </template>

      <template #footer>
        <el-button @click="shiftDialogVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!shiftCanApply" @click="confirmShift">确认执行校正</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.alert {
  margin-bottom: 14px;
}
.head-actions {
  display: flex;
  gap: 10px;
}
.shift-form {
  margin: 14px 0 4px;
}
.shift-section {
  margin: 16px 0 8px;
  font-size: 14px;
  color: #3a3a3a;
}
.shift-empty {
  margin: 8px 0 0;
  font-size: 12px;
}
.bad-depth {
  color: #c0392b;
  font-weight: 600;
}
.depth {
  display: flex;
  align-items: center;
  gap: 6px;
}
.mini {
  margin-left: 4px;
}
.warn {
  margin: 0;
  color: #c0392b;
  font-size: 12px;
}
</style>
