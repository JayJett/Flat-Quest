import type { Visual, Transformation } from '@/visual/types'
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
  tour_completed_at: string | null
  created_at: string
  updated_at: string
}

export type HouseholdRow = {
  id: string
  name: string
  address: string | null
  created_by: string | null
  settings: Json
  member_limit: number
  photo_path: string | null
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
  is_legacy: boolean
  secret_id: string | null
  created_at: string
}

/** Phase 10: a shared appointment (inspection, meter reading…), optionally needing someone home. */
export type AppointmentRow = {
  id: string
  household_id: string
  title: string
  notes: string | null
  room_id: string | null
  all_day: boolean
  scheduled_on: string
  starts_at: string | null
  ends_at: string | null
  needs_cover: boolean
  host_id: string | null
  created_by: string | null
  cancelled_at: string | null
  cancelled_by: string | null
  revision: number
  created_at: string
  updated_at: string
}

export type RoomRow = {
  id: string
  household_id: string
  name: string
  icon: string
  color: string
  sort_order: number
  import_key: string | null
  /** Optional measurements in centimetres (Phase 4). */
  width_cm: number | null
  length_cm: number | null
  height_cm: number | null
  measurement_notes: string | null
  /** Phase 9: a short shared description (≤120 characters). */
  description: string | null
  /** Phase 9: one of this room's own Visual Home images, shown as its cover. */
  cover_visual_id: string | null
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
  needs_assignees: boolean
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

export type ItemAssigneeRow = {
  item_id: string
  household_id: string
  user_id: string
  created_at: string
}

export type WishlistItemRow = {
  id: string
  household_id: string
  room_id: string | null
  title: string
  notes: string | null
  estimated_price: number | null
  shopping_url: string | null
  photo_path: string | null
  is_chosen: boolean
  chosen_at: string | null
  chosen_by: string | null
  checklist_item_id: string | null
  import_key: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type WishlistVoteRow = {
  idea_id: string
  household_id: string
  user_id: string
  created_at: string
}

/** A candidate product for one checklist item. Never a purchase in itself. */
export type ProductOptionRow = {
  id: string
  household_id: string
  item_id: string
  name: string
  retailer: string | null
  price: number | null
  url: string | null
  photo_path: string | null
  notes: string | null
  width_cm: number | null
  depth_cm: number | null
  height_cm: number | null
  is_selected: boolean
  selected_at: string | null
  selected_by: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type ProductPreferenceRow = {
  item_id: string
  user_id: string
  household_id: string
  option_id: string
  created_at: string
  updated_at: string
}

export type PurchaseCoordinatorRow = {
  item_id: string
  household_id: string
  user_id: string
  claimed_at: string
}

export type ItemPurchaseRow = {
  item_id: string
  household_id: string
  option_id: string | null
  purchased_by: string | null
  /** Calendar dates (YYYY-MM-DD), never timestamps. */
  purchased_on: string | null
  order_reference: string | null
  notes: string | null
  delivery_method: string | null
  expected_on: string | null
  tracking_url: string | null
  delivery_notes: string | null
  arrived_on: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export type InviteSummary = {
  id: string
  code: string | null
  is_legacy: boolean
  created_at: string
  created_by: string | null
  expires_at: string
  use_count: number
  people_can_join: number
  spaces_left: number
}

/** Phase 6: one durable record per meaningful change (timeline + notification source). */
export type HouseholdEventRow = {
  id: number
  household_id: string
  type: string
  actor_id: string | null
  actor_name: string | null
  room_id: string | null
  item_id: string | null
  option_id: string | null
  idea_id: string | null
  comment_id: string | null
  transformation_id: string | null
  subject_id: string | null
  /** Phase 7 */
  essential_id?: string | null
  task_id?: string | null
  data: Json
  in_timeline: boolean
  created_at: string
}

export type NotificationRow = {
  id: number
  event_id: number
  household_id: string
  recipient_id: string
  reason: string
  category: 'personal' | 'household'
  read_at: string | null
  created_at: string
}

export type CommentRow = {
  id: string
  household_id: string
  item_id: string | null
  option_id: string | null
  idea_id: string | null
  parent_id: string | null
  author_id: string | null
  author_name: string | null
  body: string
  mentions: string[]
  created_at: string
  edited_at: string | null
  deleted_at: string | null
}

/** Phase 7: consumables that run out and get re-bought (separate from furnishing items). */
export type EssentialStatus = 'needed' | 'getting' | 'stocked'
export type EssentialRow = {
  id: string
  household_id: string
  name: string
  name_key: string
  category: 'kitchen' | 'bathroom' | 'laundry' | 'cleaning' | 'other' | null
  note: string | null
  /** Phase 8: optional usual amount, e.g. "24-roll pack". */
  quantity: string | null
  status: EssentialStatus
  claimed_by: string | null
  needed_at: string | null
  needed_by: string | null
  restocked_at: string | null
  restocked_by: string | null
  archived_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type EssentialRestockRow = {
  id: number
  essential_id: string
  household_id: string
  restocked_by: string | null
  restocked_by_name: string | null
  needed_at: string | null
  restocked_at: string
  prior_status: string
  prior_claimed_by: string | null
  prior_needed_by: string | null
}

export type TaskStatus = 'todo' | 'doing' | 'done'
export type TaskRow = {
  id: string
  household_id: string
  title: string
  notes: string | null
  room_id: string | null
  assignee_id: string | null
  /** Calendar date YYYY-MM-DD. */
  due_on: string | null
  status: TaskStatus
  completed_at: string | null
  completed_by: string | null
  archived_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type UserPreferencesRow = {
  user_id: string
  accent: 'blue' | 'lavender' | 'mint' | 'coral' | 'sunshine'
  greeting_name: string | null
  motion: 'playful' | 'balanced' | 'minimal'
  home_layout: Json
  /** Phase 8 */
  muted_notifications: string[]
  updated_at: string
}

export type Database = {
  __InternalSupabase: { PostgrestVersion: '14.18' }
  public: {
    Tables: {
      room_visuals: Table<Visual, 'household_id' | 'room_id' | 'kind'>
      room_transformations: Table<Transformation, 'household_id' | 'room_id' | 'before_id' | 'after_id'>
      profiles: Table<ProfileRow, 'id'>
      households: Table<HouseholdRow, 'name'>
      household_members: Table<HouseholdMemberRow, 'household_id' | 'user_id'>
      household_invites: Table<HouseholdInviteRow, 'household_id' | 'token_hash' | 'expires_at'>
      rooms: Table<RoomRow, 'household_id' | 'name'>
      items: Table<ItemRow, 'household_id' | 'room_id' | 'name'>
      item_assignees: Table<ItemAssigneeRow, 'item_id' | 'household_id' | 'user_id'>
      wishlist_items: Table<WishlistItemRow, 'household_id' | 'title'>
      wishlist_votes: Table<WishlistVoteRow, 'idea_id' | 'household_id'>
      product_options: Table<ProductOptionRow, 'household_id' | 'item_id' | 'name'>
      product_preferences: Table<ProductPreferenceRow, 'item_id' | 'household_id' | 'option_id'>
      purchase_coordinators: Table<PurchaseCoordinatorRow, 'item_id' | 'household_id'>
      item_purchases: Table<ItemPurchaseRow, 'item_id' | 'household_id'>
      household_events: Table<HouseholdEventRow, 'household_id' | 'type'>
      notifications: Table<NotificationRow, 'event_id' | 'household_id' | 'recipient_id' | 'reason' | 'category'>
      comments: Table<CommentRow, 'household_id' | 'body'>
      essentials: Table<EssentialRow, 'household_id' | 'name'>
      essential_restocks: Table<EssentialRestockRow, 'essential_id' | 'household_id' | 'prior_status'>
      household_tasks: Table<TaskRow, 'household_id' | 'title'>
      calendar_appointments: Table<AppointmentRow, 'id' | 'household_id' | 'title' | 'all_day' | 'scheduled_on'>
      user_preferences: Table<UserPreferencesRow, never>
    }
    Views: { [_ in never]: never }
    Functions: {
      reserve_media_upload: { Args: { p_household: string; p_kind: string; p_ext: string }; Returns: Json }
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
        Returns: { household_name: string; member_count: number; is_member: boolean; spaces_left: number }[]
      }
      get_household_invites: { Args: { p_household: string }; Returns: InviteSummary[] }
      set_item_assignees: { Args: { p_item: string; p_users: string[] }; Returns: undefined }
      set_household_photo: { Args: { p_household: string; p_path: string | null }; Returns: string | null }
      add_wishlist_to_checklist: { Args: { p_idea: string; p_room?: string }; Returns: string }
      import_wishlist: {
        Args: { p_household: string; p_rows: Json }
        Returns: { ideas_created: number; ideas_skipped: number }[]
      }
      revoke_household_invite: { Args: { p_invite: string }; Returns: undefined }
      mark_all_notifications_read: { Args: { p_household: string }; Returns: number }
      update_essential: {
        Args: { p_essential: string; p_action: string; p_expected?: string | null; p_to?: string | null }
        Returns: EssentialRow
      }
      leave_household: { Args: { p_household: string }; Returns: Json }
      set_household_timezone: { Args: { p_household: string; p_zone: string }; Returns: string }
      save_appointment: {
        Args: {
          p_id: string; p_household: string; p_expected_revision: number | null; p_title: string; p_notes: string | null
          p_room: string | null; p_date: string; p_start: string | null; p_end: string | null; p_needs_cover: boolean
        }
        Returns: AppointmentRow
      }
      set_appointment_cover: { Args: { p_id: string; p_expected_revision: number; p_action: 'claim' | 'release' }; Returns: AppointmentRow }
      cancel_appointment: { Args: { p_id: string; p_expected_revision: number }; Returns: AppointmentRow }
      remove_household_member: { Args: { p_household: string; p_user: string }; Returns: Json }
      transfer_household_ownership: { Args: { p_household: string; p_user: string }; Returns: undefined }
      set_member_limit: { Args: { p_household: string; p_limit: number }; Returns: undefined }
      member_departure_summary: { Args: { p_household: string; p_user: string }; Returns: Json }
      save_item_purchase: {
        Args: {
          p_item: string
          p_expected_version: string | null
          p_option: string | null
          p_purchased_by: string | null
          p_purchased_on: string | null
          p_order_reference: string | null
          p_notes: string | null
          p_delivery_method: string | null
          p_expected_on: string | null
          p_tracking_url: string | null
          p_delivery_notes: string | null
          p_arrived_on: string | null
          p_status?: string | null
          p_expected_status?: string | null
          p_set_amount?: boolean
          p_amount?: number | null
          p_expected_amount?: number | null
        }
        Returns: Json
      }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
