import { createStore } from 'zustand/vanilla'
import type { Stratum, UnitType } from '@/types'
import { db, syncAll, syncDelete, syncPut } from '@/hooks/usePersistentStore'
import { artifactStore } from '@/stores/artifactStore'
import { roundDepth } from '@/utils/depthShift'

export interface StratumState {
  strata: Stratum[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (stratum: Stratum) => Promise<void>
  remove: (id: string) => Promise<void>
  bulkSetType: (ids: string[], type: UnitType) => Promise<void>
  /** 按探方整体平移深度（更换水准点校正）：地层上下界与出土物 Z 值在同一事务内更新 */
  shiftDepthsByTrench: (trenchId: string, offset: number) => Promise<void>
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
  shiftDepthsByTrench: async (trenchId, offset) => {
    const targets = get().strata.filter((item) => item.trenchId === trenchId)
    const targetIds = new Set(targets.map((item) => item.id))
    const artifacts = artifactStore
      .getState()
      .artifacts.filter((item) => targetIds.has(item.stratumId))
    // 地层与出土物必须在同一事务内一起更新，避免只改一半留下旧值
    await db.transaction('rw', db.strata, db.artifacts, async () => {
      await db.strata.bulkPut(
        targets.map((item) => ({
          ...item,
          topDepth: roundDepth(item.topDepth + offset),
          bottomDepth: roundDepth(item.bottomDepth + offset)
        }))
      )
      await db.artifacts.bulkPut(artifacts.map((item) => ({ ...item, z: roundDepth(item.z + offset) })))
    })
    await get().hydrate()
    await artifactStore.getState().hydrate()
  }
}))
