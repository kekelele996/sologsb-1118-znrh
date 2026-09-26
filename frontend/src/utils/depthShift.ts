import type { Artifact, Relation, Stratum } from '@/types'

/** 深度保留两位小数，规避浮点累加误差 */
export function roundDepth(value: number): number {
  return Math.round(value * 100) / 100
}

/** 深度平移后的地层单位行（预览用） */
export interface StratumShiftRow {
  stratum: Stratum
  newTopDepth: number
  newBottomDepth: number
}

/** 随地层单位一起平移的出土物行（预览用） */
export interface ArtifactShiftRow {
  artifact: Artifact
  stratum: Stratum
  newZ: number
}

/** 校正后被判定为矛盾的跨探方层位关系 */
export interface RelationConflict {
  relation: Relation
  /** 关系中位于选中探方内的一端 */
  shiftedStratum: Stratum
  /** 关系中位于其他探方的一端 */
  otherStratum: Stratum
  message: string
}

/** 按探方平移深度的试算结果 */
export interface DepthShiftPreview {
  trenchId: string
  /** 平移量（米）：正值加深、负值上移 */
  delta: number
  stratumRows: StratumShiftRow[]
  artifactRows: ArtifactShiftRow[]
  /** 平移后深度低于地表（< 0）的地层单位 */
  surfaceViolations: StratumShiftRow[]
  /** 平移后出土深度低于地表（< 0）的出土物 */
  artifactSurfaceViolations: ArtifactShiftRow[]
  /** 校正将新引入的跨探方关系矛盾（校正前不矛盾、校正后矛盾） */
  relationConflicts: RelationConflict[]
  /** 是否可执行 */
  blocked: boolean
}

/**
 * 试算某个探方整体深度平移：
 * - 选中探方的全部地层单位与挂在其下的出土物统一加上 delta；
 * - 任何深度不得低于地表（0 m）；
 * - 仅检查跨探方的「叠压 / 打破」关系：平移后新产生的矛盾才拒绝，
 *   校正前就存在的矛盾不因本次校正而拦截。
 */
export function buildDepthShiftPreview(
  trenchId: string,
  delta: number,
  strata: Stratum[],
  artifacts: Artifact[],
  relations: Relation[]
): DepthShiftPreview {
  const stratumRows: StratumShiftRow[] = strata
    .filter((item) => item.trenchId === trenchId)
    .map((stratum) => ({
      stratum,
      newTopDepth: roundDepth(stratum.topDepth + delta),
      newBottomDepth: roundDepth(stratum.bottomDepth + delta)
    }))

  const targetIds = new Set(stratumRows.map((row) => row.stratum.id))
  const artifactRows: ArtifactShiftRow[] = artifacts
    .filter((item) => targetIds.has(item.stratumId))
    .map((artifact) => {
      const stratum = strata.find((item) => item.id === artifact.stratumId) as Stratum
      return { artifact, stratum, newZ: roundDepth(artifact.z + delta) }
    })

  const surfaceViolations = stratumRows.filter((row) => row.newTopDepth < 0 || row.newBottomDepth < 0)
  const artifactSurfaceViolations = artifactRows.filter((row) => row.newZ < 0)

  /** 平移后的上界深度，便于试算关系矛盾 */
  const shiftedTop = new Map<string, number>()
  stratumRows.forEach((row) => shiftedTop.set(row.stratum.id, row.newTopDepth))
  const topOf = (id: string): number | null => {
    if (shiftedTop.has(id)) return shiftedTop.get(id) as number
    const found = strata.find((item) => item.id === id)
    return found ? found.topDepth : null
  }

  const relationConflicts: RelationConflict[] = []
  relations.forEach((relation) => {
    if (relation.type === '共存') return
    const a = strata.find((item) => item.id === relation.unitAId)
    const b = strata.find((item) => item.id === relation.unitBId)
    if (!a || !b) return
    const aShifted = a.trenchId === trenchId
    const bShifted = b.trenchId === trenchId
    // 只校验跨探方关系；同探方单位平移量相同，相对层序不会变化
    if (aShifted === bShifted) return
    const beforeConflict = a.topDepth > b.topDepth
    const aTop = topOf(a.id)
    const bTop = topOf(b.id)
    if (aTop === null || bTop === null) return
    const afterConflict = aTop > bTop
    if (afterConflict && !beforeConflict) {
      relationConflicts.push({
        relation,
        shiftedStratum: aShifted ? a : b,
        otherStratum: aShifted ? b : a,
        message: `${a.code} ${relation.type} ${b.code}：校正后 ${a.code} 上界 ${aTop} m 深于 ${b.code} 上界 ${bTop} m`
      })
    }
  })

  const blocked =
    surfaceViolations.length > 0 ||
    artifactSurfaceViolations.length > 0 ||
    relationConflicts.length > 0

  return {
    trenchId,
    delta,
    stratumRows,
    artifactRows,
    surfaceViolations,
    artifactSurfaceViolations,
    relationConflicts,
    blocked
  }
}
