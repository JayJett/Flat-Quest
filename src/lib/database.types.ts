// Generated from the Supabase schema (supabase gen types / MCP generate_typescript_types),
// trimmed to the parts the app uses. Regenerate after schema changes.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

type Table<Row, Required extends keyof Row> = {
  Row: Row
  Insert: Partial<Row> & Pick<Row, Required>
  Update: Partial<Row>
  Relationships: []
}

export type ProfileRow = {
  id: string
  display_name: string
  avatar_path: string | null
  accent_color: string
  icon: string
  preferences: Json
  created_at: string
  updated_at: string
}

export type HouseholdRow = {
  id: string
  name: string
  address: string | null
  created_by: string | null
  settings: Json
  created_at: string
  updated_at: string
}

export type HouseholdMemberRow = {
  household_id: string
  user_id: string
  role: string
  joined_at: string
}

export type HouseholdInviteRow = {
  id: string
  household_id: string
  token_hash: string
  created_by: string | null
  expires_at: string
  max_uses: number
  use_count: number
  revoked_at: string | null
  created_at: string
}

export type RoomRow = {
  id: string
  household_id: string
  name: string
  icon: string
  color: string
  sort_order: number
  import_key: string | null
  created_at: string
  updated_at: string
}

export type ItemRow = {
  id: string
  household_id: string
  room_id: string
  name: string
  description: string | null
  priority: string
  status: string
  responsibility: string
  responsible_user_id: string | null
  ownership: string
  owner_user_id: string | null
  is_complete: boolean
  completed_at: string | null
  completed_by: string | null
  estimated_price: number | null
  actual_price: number | null
  shopping_url: string | null
  notes: string | null
  sort_order: number
  import_key: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type Database = {
  __InternalSupabase: { PostgrestVersion: '14.18' }
  public: {
    Tables: {
      profiles: Table<ProfileRow, 'id'>
      households: Table<HouseholdRow, 'name'>
      household_members: Table<HouseholdMemberRow, 'household_id' | 'user_id'>
      household_invites: Table<HouseholdInviteRow, 'household_id' | 'token_hash' | 'expires_at'>
      rooms: Table<RoomRow, 'household_id' | 'name'>
      items: Table<ItemRow, 'household_id' | 'room_id' | 'name'>
    }
    Views: { [_ in never]: never }
    Functions: {
      accept_household_invite: { Args: { p_code: string }; Returns: string }
      create_household: { Args: { p_name: string; p_address?: string }; Returns: string }
      create_household_invite: {
        Args: { p_household: string; p_days?: number; p_max_uses?: number }
        Returns: string
      }
      import_checklist: {
        Args: { p_household: string; p_rows: Json }
        Returns: { rooms_created: number; items_created: number; items_skipped: number }[]
      }
      preview_household_invite: {
        Args: { p_code: string }
        Returns: { household_name: string; member_count: number; is_member: boolean }[]
      }
      revoke_household_invite: { Args: { p_invite: string }; Returns: undefined }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
