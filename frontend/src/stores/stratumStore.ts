import { createStore } from 'zustand/vanilla'
import type { Artifact, Stratum, UnitType } from '@/types'
import { db, syncAll, syncDelete, syncPut } from '@/hooks/usePersistentStore'
import { roundDepth } from '@/utils/depthShift'

export interface StratumState {
  strata: Stratum[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (stratum: Stratum) => Promise<void>
  remove: (id: string) => Promise<void>
  bulkSetType: (ids: string[], type: UnitType) => Promise<void>
  /**
   * 按探方整体校正深度：地层单位的上/下界深度与其下出土物的 Z 同量平移。
   * 跨表事务保证地层与出土物同时更新，其他探方与层位关系不动。
   * 返回受影响的地层单位数与出土物数。
   */
  shiftTrenchDepths: (trenchId: string, delta: number) => Promise<{ strata: number; artifacts: number }>
}

export const stratumStore = createStore<StratumState>((set, get) => ({
  strata: [],
  loaded: false,
  hydrate: async () => {
    const strata = await syncAll<Stratum>(db.strata)
    strata.sort((a, b) => (a.topDepth === b.topDepth ? a.code.localeCompare(b.code, 'zh-Hans-CN') : a.topDepth - b.topDepth))
    set({ strata, loaded: true })
  },
  save: async (stratum) => {
    await syncPut<Stratum>(db.strata, stratum)
    await get().hydrate()
  },
  remove: async (id) => {
    await syncDelete<Stratum>(db.strata, id)
    await get().hydrate()
  },
  bulkSetType: async (ids, type) => {
    const targets = get().strata.filter((item) => ids.includes(item.id))
    await Promise.all(targets.map((item) => syncPut<Stratum>(db.strata, { ...item, type })))
    await get().hydrate()
  },
  shiftTrenchDepths: async (trenchId, delta) => {
    let strataCount = 0
    let artifactsCount = 0
    await db.transaction('rw', db.strata, db.artifacts, async () => {
      const targets = await db.strata.where('trenchId').equals(trenchId).toArray()
      if (targets.length === 0) return
      const targetIds = targets.map((item) => item.id)
      await Promise.all(
        targets.map((item) =>
          db.strata.put({
            ...item,
            topDepth: roundDepth(item.topDepth + delta),
            bottomDepth: roundDepth(item.bottomDepth + delta)
          })
        )
      )
      strataCount = targets.length
      const linked = await db.artifacts.where('stratumId').anyOf(targetIds).toArray()
      await Promise.all(
        linked.map((item) => db.artifacts.put({ ...item, z: roundDepth(item.z + delta) } as Artifact))
      )
      artifactsCount = linked.length
    })
    await get().hydrate()
    return { strata: strataCount, artifacts: artifactsCount }
  }
}))
