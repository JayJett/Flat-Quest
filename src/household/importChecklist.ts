import checklistCsv from '../../data/checklist.csv?raw'
import { checklistFromCsv, type ImportRow } from '@/lib/csv'
import type { Json } from '@/lib/database.types'
import { errorMessage, supabase } from '@/lib/supabase'

/**
 * The 103-item CHECKLIST tab of the original Flat Quest Google Sheet, exported
 * 2026-11-10 to data/checklist.csv. Parsed with the same importer as uploads.
 */
export function bundledChecklist(): ImportRow[] {
  return withLandlordAppliances(checklistFromCsv(checklistCsv).rows)
}

/** Appliances the landlord supplies (told to us after the sheet was made). */
export const LANDLORD_APPLIANCES: { room: string; name: string; match: RegExp }[] = [
  { room: 'Kitchen', name: 'Fridge / freezer (confirm supplied)', match: /^fridge/i },
  { room: 'Kitchen', name: 'Microwave', match: /^microwave$/i },
  { room: 'Kitchen', name: 'Dishwasher', match: /^dishwasher/i },
  { room: 'Laundry & cleaning', name: 'Washing machine (confirm supplied)', match: /^washing machine/i },
  { room: 'Laundry & cleaning', name: 'Dryer', match: /dryer/i },
]

/**
 * Marks the landlord's appliances as "Provided with flat" (owned by the landlord)
 * and adds any that aren't on the sheet. The sheet's own rows keep their names.
 */
export function withLandlordAppliances(rows: ImportRow[]): ImportRow[] {
  const out = rows.map((r) => {
    const hit = LANDLORD_APPLIANCES.find((a) => a.room === r.room && a.match.test(r.name))
    return hit && r.status === 'to_decide' ? { ...r, status: 'provided' as const, owned_by: 'Landlord' } : r
  })
  for (const a of LANDLORD_APPLIANCES) {
    if (!out.some((r) => r.room === a.room && a.match.test(r.name))) {
      const template = out.find((r) => r.room === a.room)
      if (!template) continue
      out.push({
        ...template,
        name: a.name,
        priority: 'must_have',
        status: 'provided',
        done: false,
        responsible: '',
        owned_by: 'Landlord',
        estimated_price: null,
        actual_price: null,
        shopping_url: '',
        notes: '',
      })
    }
  }
  return out
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
