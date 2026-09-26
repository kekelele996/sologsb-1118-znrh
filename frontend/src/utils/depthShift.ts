import type { Artifact, Relation, Stratum } from '@/types'

/** 单个地层单位的校正预览 */
export interface StratumShiftPreview {
  stratum: Stratum
  newTopDepth: number
  newBottomDepth: number
}

/** 单件出土物的校正预览 */
export interface ArtifactShiftPreview {
  artifact: Artifact
  /** 所属单位号（展示用） */
  stratumCode: string
  newZ: number
}

/** 校正后低于地表（深度 < 0）的违规记录 */
export interface SurfaceViolation {
  kind: 'stratum' | 'artifact'
  id: string
  /** 展示用标签，如「L01 上界」「出土物 T0501②:1」 */
  label: string
  /** 校正后的深度（负值） */
  depth: number
}

/** 校正导致的跨探方层位关系矛盾记录 */
export interface CrossTrenchConflict {
  relationId: string
  type: Relation['type']
  aCode: string
  aTrenchId: string
  /** 校正后 A 的上界深度 */
  aTopDepth: number
  bCode: string
  bTrenchId: string
  /** 校正后 B 的上界深度 */
  bTopDepth: number
}

/** 按探方校正深度的预览结果 */
export interface TrenchShiftPreview {
  trenchId: string
  offset: number
  strata: StratumShiftPreview[]
  artifacts: ArtifactShiftPreview[]
  surfaceViolations: SurfaceViolation[]
  conflicts: CrossTrenchConflict[]
  /** 是否可执行：探方下有单位、无低于地表、无新增跨探方矛盾 */
  applicable: boolean
}

/** 深度统一规整到两位小数，避免浮点误差（与 stratumThickness 一致） */
export function roundDepth(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * 预览按探方整体平移深度（更换水准点后的整体校正）：
 * - 该探方全部单位的上下界深度与其出土物 Z 值同步平移，其他探方不动；
 * - 任何深度校正后不得小于 0（不能低于地表）；
 * - 对比校正前后，若新产生跨探方「叠压/打破」关系矛盾（A 叠压/打破 B 但 A 上界更深），
 *   则不可执行并列出冲突记录；同一探方内的关系因两端同步平移，相对关系不变。
 */
export function previewTrenchShift(
  strata: Stratum[],
  artifacts: Artifact[],
  relations: Relation[],
  trenchId: string,
  offset: number
): TrenchShiftPreview {
  const targets = strata.filter((item) => item.trenchId === trenchId)
  const targetIds = new Set(targets.map((item) => item.id))

  const strataPreview: StratumShiftPreview[] = targets.map((stratum) => ({
    stratum,
    newTopDepth: roundDepth(stratum.topDepth + offset),
    newBottomDepth: roundDepth(stratum.bottomDepth + offset)
  }))

  const codeOf = new Map<string, string>()
  strata.forEach((item) => codeOf.set(item.id, item.code))

  const artifactsPreview: ArtifactShiftPreview[] = artifacts
    .filter((item) => targetIds.has(item.stratumId))
    .map((artifact) => ({
      artifact,
      stratumCode: codeOf.get(artifact.stratumId) ?? '未知单位',
      newZ: roundDepth(artifact.z + offset)
    }))

  const surfaceViolations: SurfaceViolation[] = []
  strataPreview.forEach(({ stratum, newTopDepth, newBottomDepth }) => {
    if (newTopDepth < 0) {
      surfaceViolations.push({ kind: 'stratum', id: stratum.id, label: `${stratum.code} 上界深度`, depth: newTopDepth })
    }
    if (newBottomDepth < 0) {
      surfaceViolations.push({ kind: 'stratum', id: stratum.id, label: `${stratum.code} 下界深度`, depth: newBottomDepth })
    }
  })
  artifactsPreview.forEach(({ artifact, newZ }) => {
    if (newZ < 0) {
      surfaceViolations.push({ kind: 'artifact', id: artifact.id, label: `出土物 ${artifact.code}`, depth: newZ })
    }
  })

  // 校正后的上界深度表（未涉及的单位保持原值）
  const shiftedTop = new Map<string, number>()
  strata.forEach((item) => shiftedTop.set(item.id, item.topDepth))
  strataPreview.forEach(({ stratum, newTopDepth }) => shiftedTop.set(stratum.id, newTopDepth))

  const conflicts: CrossTrenchConflict[] = []
  relations.forEach((relation) => {
    if (relation.type === '共存') return
    const a = strata.find((item) => item.id === relation.unitAId)
    const b = strata.find((item) => item.id === relation.unitBId)
    if (!a || !b) return
    // 同探方两端同步平移，相对关系不变；与本探方无关的关系不受校正影响
    if (a.trenchId === b.trenchId) return
    if (a.trenchId !== trenchId && b.trenchId !== trenchId) return
    const wasConflict = a.topDepth > b.topDepth
    const afterA = shiftedTop.get(relation.unitAId) as number
    const afterB = shiftedTop.get(relation.unitBId) as number
    if (afterA > afterB && !wasConflict) {
      conflicts.push({
        relationId: relation.id,
        type: relation.type,
        aCode: a.code,
        aTrenchId: a.trenchId,
        aTopDepth: afterA,
        bCode: b.code,
        bTrenchId: b.trenchId,
        bTopDepth: afterB
      })
    }
  })

  return {
    trenchId,
    offset,
    strata: strataPreview,
    artifacts: artifactsPreview,
    surfaceViolations,
    conflicts,
    applicable: targets.length > 0 && surfaceViolations.length === 0 && conflicts.length === 0
  }
}
