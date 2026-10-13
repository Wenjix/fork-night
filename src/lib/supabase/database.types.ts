export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      pilot_wallet_requests: {
        Row: { id: string; room_id: string; project_id: string; moment_id: string; maker_id: string; maker_label: string; moment_title: string; wallet_address: string; issued_at: number; signature: string; state: string; created_at: string; decided_at: string | null; decision_signature: string | null }
        Insert: { id: string; room_id: string; project_id: string; moment_id: string; maker_id: string; maker_label: string; moment_title: string; wallet_address: string; issued_at: number; signature: string; state?: string; created_at?: string; decided_at?: string | null; decision_signature?: string | null }
        Update: { state?: string; decided_at?: string | null; decision_signature?: string | null }
        Relationships: []
      }
      waitlist_signups: {
        Row: { email: string; created_at: string; source: string; consent_version: string }
        Insert: { email: string; created_at?: string; source: string; consent_version: string }
        Update: { email?: string; created_at?: string; source?: string; consent_version?: string }
        Relationships: []
      }
      pilot_assist_limits: {
        Row: {
          guest_shape_limit: number
          guest_voice_limit: number
          id: boolean
          shape_enabled: boolean
          shape_request_limit: number
          voice_enabled: boolean
          voice_token_limit: number
        }
        Insert: {
          guest_shape_limit?: number
          guest_voice_limit?: number
          id?: boolean
          shape_enabled?: boolean
          shape_request_limit?: number
          voice_enabled?: boolean
          voice_token_limit?: number
        }
        Update: {
          guest_shape_limit?: number
          guest_voice_limit?: number
          id?: boolean
          shape_enabled?: boolean
          shape_request_limit?: number
          voice_enabled?: boolean
          voice_token_limit?: number
        }
        Relationships: []
      }
      pilot_assist_requests: {
        Row: {
          created_at: string
          id: string
          input_digest: string
          kind: string
          maker_id: string
          parent_id: string
          provider_request_id: string | null
          request_id: string
          result: Json | null
          room_id: string
          state: string
          usage: Json | null
        }
        Insert: {
          created_at?: string
          id?: string
          input_digest: string
          kind: string
          maker_id: string
          parent_id: string
          provider_request_id?: string | null
          request_id: string
          result?: Json | null
          room_id: string
          state?: string
          usage?: Json | null
        }
        Update: {
          created_at?: string
          id?: string
          input_digest?: string
          kind?: string
          maker_id?: string
          parent_id?: string
          provider_request_id?: string | null
          request_id?: string
          result?: Json | null
          room_id?: string
          state?: string
          usage?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "pilot_assist_requests_maker_id_fkey"
            columns: ["maker_id"]
            isOneToOne: false
            referencedRelation: "pilot_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pilot_assist_requests_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "pilot_moments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pilot_assist_requests_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "pilot_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      pilot_generation_budget: {
        Row: {
          cap_micro: number
          enabled: boolean
          id: boolean
          imported_expense_micro: number
          imported_requests: number
          max_requests: number
        }
        Insert: {
          cap_micro?: number
          enabled?: boolean
          id?: boolean
          imported_expense_micro?: number
          imported_requests?: number
          max_requests?: number
        }
        Update: {
          cap_micro?: number
          enabled?: boolean
          id?: boolean
          imported_expense_micro?: number
          imported_requests?: number
          max_requests?: number
        }
        Relationships: []
      }
      pilot_ideas: {
        Row: {
          body: string
          created_at: string
          id: string
          maker_id: string
          maker_label: string
          moment_id: string
          request_id: string
          room_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          maker_id: string
          maker_label: string
          moment_id: string
          request_id: string
          room_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          maker_id?: string
          maker_label?: string
          moment_id?: string
          request_id?: string
          room_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pilot_ideas_maker_id_fkey"
            columns: ["maker_id"]
            isOneToOne: false
            referencedRelation: "pilot_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pilot_ideas_moment_id_room_id_fkey"
            columns: ["moment_id", "room_id"]
            isOneToOne: false
            referencedRelation: "pilot_moments"
            referencedColumns: ["id", "room_id"]
          },
          {
            foreignKeyName: "pilot_ideas_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "pilot_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      pilot_jobs: {
        Row: {
          claim_token: string | null
          dispatch_version: number
          held_micro: number
          operation_id: string
          panel_count: number
          state: string
          updated_at: string
        }
        Insert: {
          claim_token?: string | null
          dispatch_version?: number
          held_micro?: number
          operation_id: string
          panel_count?: number
          state?: string
          updated_at?: string
        }
        Update: {
          claim_token?: string | null
          dispatch_version?: number
          held_micro?: number
          operation_id?: string
          panel_count?: number
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pilot_jobs_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: true
            referencedRelation: "pilot_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      pilot_local_refills: {
        Row: {
          actor: string
          created_at: string
          credits: number
          request_id: string
          room_id: string
        }
        Insert: {
          actor: string
          created_at?: string
          credits?: number
          request_id: string
          room_id: string
        }
        Update: {
          actor?: string
          created_at?: string
          credits?: number
          request_id?: string
          room_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pilot_local_refills_actor_fkey"
            columns: ["actor"]
            isOneToOne: false
            referencedRelation: "pilot_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pilot_local_refills_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "pilot_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      pilot_moments: {
        Row: {
          created_at: string
          id: string
          maker_id: string | null
          maker_label: string
          panels: Json
          parent_id: string | null
          room_id: string
          source_idea_body: string | null
          source_idea_id: string | null
          source_idea_label: string | null
          source_kind: string
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          maker_id?: string | null
          maker_label: string
          panels: Json
          parent_id?: string | null
          room_id: string
          source_idea_body?: string | null
          source_idea_id?: string | null
          source_idea_label?: string | null
          source_kind: string
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          maker_id?: string | null
          maker_label?: string
          panels?: Json
          parent_id?: string | null
          room_id?: string
          source_idea_body?: string | null
          source_idea_id?: string | null
          source_idea_label?: string | null
          source_kind?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "pilot_moments_maker_id_fkey"
            columns: ["maker_id"]
            isOneToOne: false
            referencedRelation: "pilot_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pilot_moments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "pilot_moments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pilot_moments_parent_id_room_id_fkey"
            columns: ["parent_id", "room_id"]
            isOneToOne: false
            referencedRelation: "pilot_moments"
            referencedColumns: ["id", "room_id"]
          },
          {
            foreignKeyName: "pilot_moments_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "pilot_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pilot_moments_source_idea_id_fkey"
            columns: ["source_idea_id"]
            isOneToOne: false
            referencedRelation: "pilot_ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      pilot_operations: {
        Row: {
          charged_units: number
          created_at: string
          generation_error: string | null
          id: string
          maker_id: string
          panels: Json | null
          parent_id: string
          prompt: string
          published_moment_id: string | null
          request_id: string
          requested_captions: Json | null
          room_id: string
          source_idea_body: string | null
          source_idea_id: string | null
          source_idea_label: string | null
          source_kind: string | null
          status: string
          title: string
        }
        Insert: {
          charged_units?: number
          created_at?: string
          generation_error?: string | null
          id?: string
          maker_id: string
          panels?: Json | null
          parent_id: string
          prompt: string
          published_moment_id?: string | null
          request_id: string
          requested_captions?: Json | null
          room_id: string
          source_idea_body?: string | null
          source_idea_id?: string | null
          source_idea_label?: string | null
          source_kind?: string | null
          status?: string
          title: string
        }
        Update: {
          charged_units?: number
          created_at?: string
          generation_error?: string | null
          id?: string
          maker_id?: string
          panels?: Json | null
          parent_id?: string
          prompt?: string
          published_moment_id?: string | null
          request_id?: string
          requested_captions?: Json | null
          room_id?: string
          source_idea_body?: string | null
          source_idea_id?: string | null
          source_idea_label?: string | null
          source_kind?: string | null
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "pilot_operations_maker_id_fkey"
            columns: ["maker_id"]
            isOneToOne: false
            referencedRelation: "pilot_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pilot_operations_parent_id_room_id_fkey"
            columns: ["parent_id", "room_id"]
            isOneToOne: false
            referencedRelation: "pilot_moments"
            referencedColumns: ["id", "room_id"]
          },
          {
            foreignKeyName: "pilot_operations_published_moment_id_fkey"
            columns: ["published_moment_id"]
            isOneToOne: true
            referencedRelation: "pilot_moments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pilot_operations_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "pilot_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pilot_operations_source_idea_id_fkey"
            columns: ["source_idea_id"]
            isOneToOne: false
            referencedRelation: "pilot_ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      pilot_panel_attempts: {
        Row: {
          created_at: string
          elapsed_ms: number | null
          error_code: string | null
          expense_micro: number | null
          image_digest: string | null
          image_path: string | null
          input_digest: string
          operation_id: string
          panel_number: number
          request_id: string | null
          response_digest: string | null
          state: string
        }
        Insert: {
          created_at?: string
          elapsed_ms?: number | null
          error_code?: string | null
          expense_micro?: number | null
          image_digest?: string | null
          image_path?: string | null
          input_digest: string
          operation_id: string
          panel_number: number
          request_id?: string | null
          response_digest?: string | null
          state?: string
        }
        Update: {
          created_at?: string
          elapsed_ms?: number | null
          error_code?: string | null
          expense_micro?: number | null
          image_digest?: string | null
          image_path?: string | null
          input_digest?: string
          operation_id?: string
          panel_number?: number
          request_id?: string | null
          response_digest?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "pilot_panel_attempts_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "pilot_jobs"
            referencedColumns: ["operation_id"]
          },
        ]
      }
      pilot_profiles: {
        Row: {
          created_at: string
          display_name: string
          id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
        }
        Relationships: []
      }
      pilot_room_capacity: {
        Row: {
          delivery_limit: number
          guest_attempt_limit: number
          room_id: string
        }
        Insert: {
          delivery_limit?: number
          guest_attempt_limit?: number
          room_id: string
        }
        Update: {
          delivery_limit?: number
          guest_attempt_limit?: number
          room_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pilot_room_capacity_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: true
            referencedRelation: "pilot_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      pilot_rooms: {
        Row: {
          description: string
          funding_policy: string
          id: string
          is_open: boolean
          owner_id: string | null
          title: string
        }
        Insert: {
          description: string
          funding_policy?: string
          id: string
          is_open?: boolean
          owner_id?: string | null
          title: string
        }
        Update: {
          description?: string
          funding_policy?: string
          id?: string
          is_open?: boolean
          owner_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "pilot_rooms_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "pilot_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      pilot_submit_wallet_request: {
        Args: { p_id: string; p_room_id: string; p_project_id: string; p_moment_id: string; p_actor: string; p_wallet: string; p_issued_at: number; p_signature: string }
        Returns: Database["public"]["Tables"]["pilot_wallet_requests"]["Row"]
      }
      pilot_begin_panel: {
        Args: {
          p_claim_token: string
          p_input_digest: string
          p_operation_id: string
          p_panel_number: number
        }
        Returns: boolean
      }
      pilot_can_read_media: { Args: { p_name: string }; Returns: boolean }
      pilot_claim_assist: {
        Args: {
          p_actor: string
          p_digest: string
          p_kind: string
          p_parent_id: string
          p_request_id: string
          p_room_id: string
        }
        Returns: Json
      }
      pilot_claim_job: {
        Args: { p_claim_token: string; p_operation_id: string }
        Returns: boolean
      }
      pilot_discard: {
        Args: { p_operation_id: string }
        Returns: {
          charged_units: number
          created_at: string
          generation_error: string | null
          id: string
          maker_id: string
          panels: Json | null
          parent_id: string
          prompt: string
          published_moment_id: string | null
          request_id: string
          requested_captions: Json | null
          room_id: string
          source_idea_body: string | null
          source_idea_id: string | null
          source_idea_label: string | null
          source_kind: string | null
          status: string
          title: string
        }
        SetofOptions: {
          from: "*"
          to: "pilot_operations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pilot_finish_job: {
        Args: {
          p_claim_token: string
          p_error?: string
          p_operation_id: string
        }
        Returns: undefined
      }
      pilot_leave_idea: {
        Args: {
          p_body: string
          p_moment_id: string
          p_request_id: string
          p_room_id: string
        }
        Returns: {
          body: string
          created_at: string
          id: string
          maker_id: string
          maker_label: string
          moment_id: string
          request_id: string
          room_id: string
        }
        SetofOptions: {
          from: "*"
          to: "pilot_ideas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pilot_publish: {
        Args: { p_operation_id: string }
        Returns: {
          created_at: string
          id: string
          maker_id: string | null
          maker_label: string
          panels: Json
          parent_id: string | null
          room_id: string
          source_idea_body: string | null
          source_idea_id: string | null
          source_idea_label: string | null
          source_kind: string
          title: string
        }
        SetofOptions: {
          from: "*"
          to: "pilot_moments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pilot_record_panel: {
        Args: {
          p_claim_token: string
          p_elapsed_ms: number
          p_error_code: string
          p_expense_micro: number
          p_image_digest: string
          p_image_path: string
          p_operation_id: string
          p_panel_number: number
          p_request_id: string
          p_response_digest: string
          p_state: string
        }
        Returns: undefined
      }
      pilot_refill_room: {
        Args: { p_actor: string; p_request_id: string; p_room_id: string }
        Returns: Json
      }
      pilot_request_generation: {
        Args: { p_operation_id: string }
        Returns: {
          claim_token: string | null
          dispatch_version: number
          held_micro: number
          operation_id: string
          panel_count: number
          state: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "pilot_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pilot_room_credits: { Args: { p_room_id: string }; Returns: Json }
      pilot_save_continuation: {
        Args: {
          p_captions: Json
          p_idea_id?: string
          p_parent_id: string
          p_prompt: string
          p_request_id: string
          p_room_id: string
          p_title: string
        }
        Returns: {
          charged_units: number
          created_at: string
          generation_error: string | null
          id: string
          maker_id: string
          panels: Json | null
          parent_id: string
          prompt: string
          published_moment_id: string | null
          request_id: string
          requested_captions: Json | null
          room_id: string
          source_idea_body: string | null
          source_idea_id: string | null
          source_idea_label: string | null
          source_kind: string | null
          status: string
          title: string
        }
        SetofOptions: {
          from: "*"
          to: "pilot_operations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pilot_save_draft: {
        Args: {
          p_parent_id: string
          p_prompt: string
          p_request_id: string
          p_room_id: string
          p_title: string
        }
        Returns: {
          charged_units: number
          created_at: string
          generation_error: string | null
          id: string
          maker_id: string
          panels: Json | null
          parent_id: string
          prompt: string
          published_moment_id: string | null
          request_id: string
          requested_captions: Json | null
          room_id: string
          source_idea_body: string | null
          source_idea_id: string | null
          source_idea_label: string | null
          source_kind: string | null
          status: string
          title: string
        }
        SetofOptions: {
          from: "*"
          to: "pilot_operations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pilot_set_display_name: {
        Args: { p_name: string }
        Returns: {
          created_at: string
          display_name: string
          id: string
        }
        SetofOptions: {
          from: "*"
          to: "pilot_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
