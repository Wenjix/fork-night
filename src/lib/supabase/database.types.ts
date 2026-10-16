export type ExecutionClaim = { p_operation_id: string; p_claim_token: string; p_version: number; p_environment: string; p_run_id: string }
export type JobDispatch = {
  operation_id: string; dispatch_version: number; environment: string; state: string;
  run_id: string | null; lease_token: string | null; lease_until: string | null;
  enqueue_attempts: number; next_check_at: string; observed_status: string | null;
  terminal_observed_at: string | null; error_code: string | null; created_at: string;
}

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
      pilot_execution_reviews: {
        Row: { id: string; operation_id: string; action: string; observed_status: string; run_id: string | null; reason: string; evidence_ref: string; created_at: string }
        Insert: never
        Update: never
        Relationships: []
      }
      pilot_rehearsal_allowances: {
        Row: { id: string; room_id: string; settings: Json; created_at: string }
        Insert: never
        Update: never
        Relationships: []
      }
      pilot_room_templates: {
        Row: { id: string; version: number; title: string; description: string; seed_title: string; seed_byline: string; panels: Json; source_ref: string; enabled: boolean }
        Insert: { id: string; version: number; title: string; description: string; seed_title: string; seed_byline: string; panels: Json; source_ref: string; enabled?: boolean }
        Update: { enabled?: boolean }
        Relationships: []
      }
      pilot_demo_limits: {
        Row: { id: boolean; creation_enabled: boolean; campaign: string; room_limit: number; credit_limit: number; credits_per_room: number; rooms_per_creator: number; guest_attempt_limit: number }
        Insert: { id?: boolean; creation_enabled?: boolean; campaign?: string; room_limit?: number; credit_limit?: number; credits_per_room?: number; rooms_per_creator?: number; guest_attempt_limit?: number }
        Update: { creation_enabled?: boolean; campaign?: string; room_limit?: number; credit_limit?: number; credits_per_room?: number; guest_attempt_limit?: number }
        Relationships: []
      }
      pilot_room_creations: {
        Row: { maker_id: string; request_id: string; room_id: string; campaign: string; template_id: string; template_version: number; title: string; granted_credits: number; created_at: string }
        Insert: never
        Update: never
        Relationships: []
      }
      pilot_room_participants: {
        Row: { room_id: string; maker_id: string; public_id: string; display_name: string; joined_at: string }
        Insert: never
        Update: never
        Relationships: [{ foreignKeyName: "pilot_room_participants_room_id_fkey"; columns: ["room_id"]; isOneToOne: false; referencedRelation: "pilot_rooms"; referencedColumns: ["id"] }]
      }
      pilot_job_dispatches: {
        Row: JobDispatch
        Insert: Partial<JobDispatch> & { operation_id: string; dispatch_version: number; environment: string }
        Update: Partial<JobDispatch>
        Relationships: []
      }
      pilot_expense_reviews: {
        Row: { sequence: number; id: string; operation_id: string; panel_number: number; actual_micro: number; reason: string; evidence_ref: string; created_at: string }
        Insert: { id: string; operation_id: string; panel_number: number; actual_micro: number; reason: string; evidence_ref: string; created_at?: string }
        Update: never
        Relationships: []
      }
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
          execution_environment: string | null
          last_reconcile_at: string | null
          cap_micro: number
          enabled: boolean
          id: boolean
          imported_expense_micro: number
          imported_requests: number
          max_requests: number
        }
        Insert: {
          execution_environment?: string | null
          last_reconcile_at?: string | null
          cap_micro?: number
          enabled?: boolean
          id?: boolean
          imported_expense_micro?: number
          imported_requests?: number
          max_requests?: number
        }
        Update: {
          execution_environment?: string | null
          last_reconcile_at?: string | null
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
          legacy_terminal_observed_at: string | null
          execution_environment: string | null
          run_id: string | null
          lease_until: string | null
          heartbeat_at: string | null
          recovery_count: number
          claim_token: string | null
          dispatch_version: number
          held_micro: number
          operation_id: string
          panel_count: number
          state: string
          updated_at: string
        }
        Insert: {
          legacy_terminal_observed_at?: string | null
          execution_environment?: string | null
          run_id?: string | null
          lease_until?: string | null
          heartbeat_at?: string | null
          recovery_count?: number
          claim_token?: string | null
          dispatch_version?: number
          held_micro?: number
          operation_id: string
          panel_count?: number
          state?: string
          updated_at?: string
        }
        Update: {
          legacy_terminal_observed_at?: string | null
          execution_environment?: string | null
          run_id?: string | null
          lease_until?: string | null
          heartbeat_at?: string | null
          recovery_count?: number
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
          request_deadline: string | null
          expense_basis: string
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
          request_deadline?: string | null
          expense_basis?: string
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
          request_deadline?: string | null
          expense_basis?: string
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
          is_listed: boolean
          template_id: string | null
          template_version: number | null
          revision: number
          description: string
          funding_policy: string
          id: string
          is_open: boolean
          owner_id: string | null
          title: string
        }
        Insert: {
          is_listed?: boolean
          template_id?: string | null
          template_version?: number | null
          revision?: number
          description: string
          funding_policy?: string
          id: string
          is_open?: boolean
          owner_id?: string | null
          title: string
        }
        Update: {
          is_listed?: boolean
          template_id?: string | null
          template_version?: number | null
          revision?: number
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
      pilot_panel_accounting: {
        Row: Database["public"]["Tables"]["pilot_panel_attempts"]["Row"] & { accounted_micro: number; expense_known: boolean; reviewed: boolean }
        Relationships: []
      }
    }
    Functions: {
      pilot_wren_assistance: { Args: { p_room_id: string }; Returns: { moment_id: string; agent_label: string }[] }
      pilot_prepare_judge_room: { Args: { p_grant_id: string; p_room_id: string }; Returns: Json }
      pilot_readiness: { Args: { p_room_id: string }; Returns: Json }
      pilot_review_legacy_job: { Args: { p_review_id: string; p_operation_id: string; p_action: string; p_status: string; p_run_id: string | null; p_reason: string; p_evidence_ref: string }; Returns: undefined }
      pilot_creation_status: { Args: Record<string, never>; Returns: Json }
      pilot_create_room: { Args: { p_request_id: string; p_template_id: string; p_template_version: number; p_title: string }; Returns: Json }
      pilot_join_room: { Args: { p_room_id: string }; Returns: Json }
      pilot_room_snapshot: { Args: { p_room_id: string }; Returns: Json }
      pilot_spending_paused: { Args: { p_allow_healthy?: boolean }; Returns: boolean }
      pilot_lease_dispatch: { Args: { p_operation_id: string; p_version: number; p_environment: string; p_token: string }; Returns: Json }
      pilot_ack_dispatch: { Args: { p_operation_id: string; p_version: number; p_token: string; p_run_id: string }; Returns: boolean }
      pilot_claim_execution: { Args: ExecutionClaim; Returns: boolean }
      pilot_heartbeat: { Args: ExecutionClaim; Returns: boolean }
      pilot_defer_job: { Args: { p_operation_id: string; p_claim_token: string }; Returns: undefined }
      pilot_reconcile_execution: { Args: { p_operation_id: string; p_version: number; p_run_id: string; p_status: string; p_recover: boolean }; Returns: string }
      pilot_review_expense: { Args: { p_review_id: string; p_operation_id: string; p_panel_number: number; p_actual_micro: number; p_reason: string; p_evidence_ref: string }; Returns: undefined }
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
        Returns: { operation_id: string; state: string; panel_count: number; updated_at: string; dispatch_version: number }
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
