import checklistCsv from '../../data/checklist.csv?raw'
import { checklistFromCsv, type ImportRow } from '@/lib/csv'
import type { Json } from '@/lib/database.types'
import { errorMessage, supabase } from '@/lib/supabase'

/**
 * The 103-item CHECKLIST tab of "🏡 Flat Quest — 9 Rua Kai Wai", exported
 * 2026-11-10 to data/checklist.csv. Parsed with the same importer as uploads.
 */
export function bundledChecklist(): ImportRow[] {
  return checklistFromCsv(checklistCsv).rows
}

export interface ImportSummary {
  roomsCreated: number
  itemsCreated: number
  itemsSkipped: number
}

/** Idempotent: rows already imported (same room + item name) are skipped. */
export async function runImport(
  householdId: string,
  rows: ImportRow[],
): Promise<{ ok: true; data: ImportSummary } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('import_checklist', {
    p_household: householdId,
    p_rows: rows as unknown as Json,
  })
  if (error) return { ok: false, error: errorMessage(error) }
  const r = data?.[0]
  return {
    ok: true,
    data: {
      roomsCreated: r?.rooms_created ?? 0,
      itemsCreated: r?.items_created ?? 0,
      itemsSkipped: r?.items_skipped ?? 0,
    },
  }
}
