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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
      agent_scorecards: {
        Row: {
          agent_id: string | null
          appointments_set: number | null
          calls_made: number | null
          coaching_notes: string | null
          conversion_rate: number | null
          created_at: string | null
          goal_appointments_hit: boolean | null
          goal_calls_hit: boolean | null
          goal_policies_hit: boolean | null
          id: string
          policies_sold: number | null
          talk_time: number | null
          week_end: string
          week_start: string
        }
        Insert: {
          agent_id?: string | null
          appointments_set?: number | null
          calls_made?: number | null
          coaching_notes?: string | null
          conversion_rate?: number | null
          created_at?: string | null
          goal_appointments_hit?: boolean | null
          goal_calls_hit?: boolean | null
          goal_policies_hit?: boolean | null
          id?: string
          policies_sold?: number | null
          talk_time?: number | null
          week_end: string
          week_start: string
        }
        Update: {
          agent_id?: string | null
          appointments_set?: number | null
          calls_made?: number | null
          coaching_notes?: string | null
          conversion_rate?: number | null
          created_at?: string | null
          goal_appointments_hit?: boolean | null
          goal_calls_hit?: boolean | null
          goal_policies_hit?: boolean | null
          id?: string
          policies_sold?: number | null
          talk_time?: number | null
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
      appointments: {
        Row: {
          contact_id: string | null
          contact_name: string | null
          created_at: string | null
          created_by: string | null
          end_time: string | null
          external_event_id: string | null
          external_last_synced_at: string | null
          external_provider: string | null
          id: string
          notes: string | null
          start_time: string
          status: string
          sync_source: string
          title: string
          type: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          contact_id?: string | null
          contact_name?: string | null
          created_at?: string | null
          created_by?: string | null
          end_time?: string | null
          external_event_id?: string | null
          external_last_synced_at?: string | null
          external_provider?: string | null
          id?: string
          notes?: string | null
          start_time: string
          status?: string
          sync_source?: string
          title: string
          type?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          contact_id?: string | null
          contact_name?: string | null
          created_at?: string | null
          created_by?: string | null
          end_time?: string | null
          external_event_id?: string | null
          external_last_synced_at?: string | null
          external_provider?: string | null
          id?: string
          notes?: string | null
          start_time?: string
          status?: string
          sync_source?: string
          title?: string
          type?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      area_code_mapping: {
        Row: {
          area_code: string
          city: string | null
          created_at: string | null
          id: string
          state: string
          timezone: string | null
        }
        Insert: {
          area_code: string
          city?: string | null
          created_at?: string | null
          id?: string
          state: string
          timezone?: string | null
        }
        Update: {
          area_code?: string
          city?: string | null
          created_at?: string | null
          id?: string
          state?: string
          timezone?: string | null
        }
        Relationships: []
      }
      business_hours: {
        Row: {
          close_time: string | null
          created_at: string | null
          day_of_week: number
          id: string
          is_open: boolean | null
          open_time: string | null
          updated_at: string | null
        }
        Insert: {
          close_time?: string | null
          created_at?: string | null
          day_of_week: number
          id?: string
          is_open?: boolean | null
          open_time?: string | null
          updated_at?: string | null
        }
        Update: {
          close_time?: string | null
          created_at?: string | null
          day_of_week?: number
          id?: string
          is_open?: boolean | null
          open_time?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      calendar_integrations: {
        Row: {
          access_token: string | null
          calendar_id: string | null
          created_at: string
          id: string
          last_sync_at: string | null
          last_sync_token: string | null
          provider: string
          refresh_token: string | null
          sync_enabled: boolean
          sync_mode: string
          token_expires_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          calendar_id?: string | null
          created_at?: string
          id?: string
          last_sync_at?: string | null
          last_sync_token?: string | null
          provider?: string
          refresh_token?: string | null
          sync_enabled?: boolean
          sync_mode?: string
          token_expires_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string | null
          calendar_id?: string | null
          created_at?: string
          id?: string
          last_sync_at?: string | null
          last_sync_token?: string | null
          provider?: string
          refresh_token?: string | null
          sync_enabled?: boolean
          sync_mode?: string
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      call_scripts: {
        Row: {
          active: boolean | null
          content: string | null
          created_at: string | null
          id: string
          name: string
          product_type: string
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          content?: string | null
          created_at?: string | null
          id?: string
          name: string
          product_type: string
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          content?: string | null
          created_at?: string | null
          id?: string
          name?: string
          product_type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      calls: {
        Row: {
          agent_id: string | null
          amd_result: string | null
          caller_id_used: string | null
          campaign_id: string | null
          campaign_lead_id: string | null
          contact_id: string | null
          contact_name: string | null
          contact_phone: string | null
          contact_type: string | null
          created_at: string | null
          direction: string | null
          disposition_id: string | null
          disposition_name: string | null
          duration: number | null
          ended_at: string | null
          flagged_for_coaching: boolean | null
          hangup_details: string | null
          id: string
          mos: number | null
          notes: string | null
          outcome: string | null
          pdd_seconds: number | null
          quality_percentage: number | null
          recording_url: string | null
          shaken_stir: string | null
          sip_response_code: number | null
          started_at: string | null
          status: string | null
          telnyx_call_id: string | null
          telnyx_error_code: string | null
          transcript: Json | null
        }
        Insert: {
          agent_id?: string | null
          amd_result?: string | null
          caller_id_used?: string | null
          campaign_id?: string | null
          campaign_lead_id?: string | null
          contact_id?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contact_type?: string | null
          created_at?: string | null
          direction?: string | null
          disposition_id?: string | null
          disposition_name?: string | null
          duration?: number | null
          ended_at?: string | null
          flagged_for_coaching?: boolean | null
          hangup_details?: string | null
          id?: string
          mos?: number | null
          notes?: string | null
          outcome?: string | null
          pdd_seconds?: number | null
          quality_percentage?: number | null
          recording_url?: string | null
          shaken_stir?: string | null
          sip_response_code?: number | null
          started_at?: string | null
          status?: string | null
          telnyx_call_id?: string | null
          telnyx_error_code?: string | null
          transcript?: Json | null
        }
        Update: {
          agent_id?: string | null
          amd_result?: string | null
          caller_id_used?: string | null
          campaign_id?: string | null
          campaign_lead_id?: string | null
          contact_id?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contact_type?: string | null
          created_at?: string | null
          direction?: string | null
          disposition_id?: string | null
          disposition_name?: string | null
          duration?: number | null
          ended_at?: string | null
          flagged_for_coaching?: boolean | null
          hangup_details?: string | null
          id?: string
          mos?: number | null
          notes?: string | null
          outcome?: string | null
          pdd_seconds?: number | null
          quality_percentage?: number | null
          recording_url?: string | null
          shaken_stir?: string | null
          sip_response_code?: number | null
          started_at?: string | null
          status?: string | null
          telnyx_call_id?: string | null
          telnyx_error_code?: string | null
          transcript?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "calls_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_campaign_lead_id_fkey"
            columns: ["campaign_lead_id"]
            isOneToOne: false
            referencedRelation: "campaign_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_disposition_id_fkey"
            columns: ["disposition_id"]
            isOneToOne: false
            referencedRelation: "dispositions"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_leads: {
        Row: {
          age: number | null
          call_attempts: number | null
          campaign_id: string
          claimed_at: string | null
          claimed_by: string | null
          created_at: string | null
          disposition: string | null
          email: string | null
          first_name: string | null
          id: string
          last_called_at: string | null
          last_name: string | null
          lead_id: string | null
          locked_at: string | null
          locked_by: string | null
          phone: string | null
          sort_order: number | null
          source: string | null
          state: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          age?: number | null
          call_attempts?: number | null
          campaign_id: string
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string | null
          disposition?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_called_at?: string | null
          last_name?: string | null
          lead_id?: string | null
          locked_at?: string | null
          locked_by?: string | null
          phone?: string | null
          sort_order?: number | null
          source?: string | null
          state?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          age?: number | null
          call_attempts?: number | null
          campaign_id?: string
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string | null
          disposition?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_called_at?: string | null
          last_name?: string | null
          lead_id?: string | null
          locked_at?: string | null
          locked_by?: string | null
          phone?: string | null
          sort_order?: number | null
          source?: string | null
          state?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_leads_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          assigned_agent_ids: Json | null
          auto_dial_enabled: boolean | null
          calling_hours_end: string | null
          calling_hours_start: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          leads_contacted: number | null
          leads_converted: number | null
          local_presence_enabled: boolean | null
          max_attempts: number | null
          name: string
          retry_interval_hours: number | null
          status: string
          tags: Json | null
          total_leads: number | null
          type: string
          updated_at: string | null
        }
        Insert: {
          assigned_agent_ids?: Json | null
          auto_dial_enabled?: boolean | null
          calling_hours_end?: string | null
          calling_hours_start?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          leads_contacted?: number | null
          leads_converted?: number | null
          local_presence_enabled?: boolean | null
          max_attempts?: number | null
          name: string
          retry_interval_hours?: number | null
          status?: string
          tags?: Json | null
          total_leads?: number | null
          type?: string
          updated_at?: string | null
        }
        Update: {
          assigned_agent_ids?: Json | null
          auto_dial_enabled?: boolean | null
          calling_hours_end?: string | null
          calling_hours_start?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          leads_contacted?: number | null
          leads_converted?: number | null
          local_presence_enabled?: boolean | null
          max_attempts?: number | null
          name?: string
          retry_interval_hours?: number | null
          status?: string
          tags?: Json | null
          total_leads?: number | null
          type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      carriers: {
        Row: {
          created_at: string
          id: string
          is_appointed: boolean | null
          name: string
          portal_url: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_appointed?: boolean | null
          name: string
          portal_url?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_appointed?: boolean | null
          name?: string
          portal_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      chat_group_members: {
        Row: {
          group_id: string
          id: string
          joined_at: string
          user_id: string
        }
        Insert: {
          group_id: string
          id?: string
          joined_at?: string
          user_id: string
        }
        Update: {
          group_id?: string
          id?: string
          joined_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "chat_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_groups: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          content: string
          created_at: string
          group_id: string
          id: string
          sender_id: string
        }
        Insert: {
          content: string
          created_at?: string
          group_id: string
          id?: string
          sender_id: string
        }
        Update: {
          content?: string
          created_at?: string
          group_id?: string
          id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "chat_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          assigned_agent_id: string
          beneficiary_name: string | null
          beneficiary_phone: string | null
          beneficiary_relationship: string | null
          carrier: string | null
          created_at: string
          custom_fields: Json | null
          effective_date: string | null
          email: string
          face_amount: number | null
          first_name: string
          id: string
          issue_date: string | null
          last_name: string
          lead_id: string | null
          notes: string | null
          phone: string
          policy_number: string | null
          policy_type: string
          premium: number | null
          premium_amount: number | null
          updated_at: string
        }
        Insert: {
          assigned_agent_id?: string
          beneficiary_name?: string | null
          beneficiary_phone?: string | null
          beneficiary_relationship?: string | null
          carrier?: string | null
          created_at?: string
          custom_fields?: Json | null
          effective_date?: string | null
          email?: string
          face_amount?: number | null
          first_name?: string
          id?: string
          issue_date?: string | null
          last_name?: string
          lead_id?: string | null
          notes?: string | null
          phone?: string
          policy_number?: string | null
          policy_type?: string
          premium?: number | null
          premium_amount?: number | null
          updated_at?: string
        }
        Update: {
          assigned_agent_id?: string
          beneficiary_name?: string | null
          beneficiary_phone?: string | null
          beneficiary_relationship?: string | null
          carrier?: string | null
          created_at?: string
          custom_fields?: Json | null
          effective_date?: string | null
          email?: string
          face_amount?: number | null
          first_name?: string
          id?: string
          issue_date?: string | null
          last_name?: string
          lead_id?: string | null
          notes?: string | null
          phone?: string
          policy_number?: string | null
          policy_type?: string
          premium?: number | null
          premium_amount?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      company_settings: {
        Row: {
          company_name: string
          company_phone: string | null
          created_at: string
          date_format: string | null
          favicon_name: string | null
          favicon_url: string | null
          id: string
          logo_name: string | null
          logo_url: string | null
          primary_color: string | null
          time_format: string | null
          timezone: string | null
          updated_at: string
        }
        Insert: {
          company_name: string
          company_phone?: string | null
          created_at?: string
          date_format?: string | null
          favicon_name?: string | null
          favicon_url?: string | null
          id?: string
          logo_name?: string | null
          logo_url?: string | null
          primary_color?: string | null
          time_format?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          company_name?: string
          company_phone?: string | null
          created_at?: string
          date_format?: string | null
          favicon_name?: string | null
          favicon_url?: string | null
          id?: string
          logo_name?: string | null
          logo_url?: string | null
          primary_color?: string | null
          time_format?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      contact_activities: {
        Row: {
          activity_type: string
          agent_id: string | null
          contact_id: string
          contact_type: string
          created_at: string
          description: string
          id: string
          metadata: Json | null
        }
        Insert: {
          activity_type?: string
          agent_id?: string | null
          contact_id: string
          contact_type?: string
          created_at?: string
          description?: string
          id?: string
          metadata?: Json | null
        }
        Update: {
          activity_type?: string
          agent_id?: string | null
          contact_id?: string
          contact_type?: string
          created_at?: string
          description?: string
          id?: string
          metadata?: Json | null
        }
        Relationships: []
      }
      contact_notes: {
        Row: {
          author_id: string | null
          contact_id: string
          contact_type: string
          content: string
          created_at: string
          id: string
          pinned: boolean
        }
        Insert: {
          author_id?: string | null
          contact_id: string
          contact_type?: string
          content?: string
          created_at?: string
          id?: string
          pinned?: boolean
        }
        Update: {
          author_id?: string | null
          contact_id?: string
          contact_type?: string
          content?: string
          created_at?: string
          id?: string
          pinned?: boolean
        }
        Relationships: []
      }
      custom_menu_links: {
        Row: {
          created_at: string
          icon: string | null
          id: string
          label: string
          sort_order: number | null
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          icon?: string | null
          id?: string
          label: string
          sort_order?: number | null
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          icon?: string | null
          id?: string
          label?: string
          sort_order?: number | null
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      dialer_sessions: {
        Row: {
          agent_id: string | null
          auto_dial_enabled: boolean | null
          calls_connected: number | null
          calls_made: number | null
          campaign_id: string | null
          campaign_name: string | null
          created_at: string | null
          ended_at: string | null
          id: string
          mode: string | null
          policies_sold: number | null
          started_at: string | null
          total_talk_time: number | null
        }
        Insert: {
          agent_id?: string | null
          auto_dial_enabled?: boolean | null
          calls_connected?: number | null
          calls_made?: number | null
          campaign_id?: string | null
          campaign_name?: string | null
          created_at?: string | null
          ended_at?: string | null
          id?: string
          mode?: string | null
          policies_sold?: number | null
          started_at?: string | null
          total_talk_time?: number | null
        }
        Update: {
          agent_id?: string | null
          auto_dial_enabled?: boolean | null
          calls_connected?: number | null
          calls_made?: number | null
          campaign_id?: string | null
          campaign_name?: string | null
          created_at?: string | null
          ended_at?: string | null
          id?: string
          mode?: string | null
          policies_sold?: number | null
          started_at?: string | null
          total_talk_time?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "dialer_sessions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      dispositions: {
        Row: {
          appointment_scheduler: boolean
          automation_id: string | null
          automation_name: string | null
          automation_trigger: boolean
          callback_scheduler: boolean
          color: string
          created_at: string
          id: string
          is_default: boolean
          min_note_chars: number
          name: string
          require_notes: boolean
          sort_order: number
          updated_at: string
          usage_count: number
        }
        Insert: {
          appointment_scheduler?: boolean
          automation_id?: string | null
          automation_name?: string | null
          automation_trigger?: boolean
          callback_scheduler?: boolean
          color?: string
          created_at?: string
          id?: string
          is_default?: boolean
          min_note_chars?: number
          name: string
          require_notes?: boolean
          sort_order?: number
          updated_at?: string
          usage_count?: number
        }
        Update: {
          appointment_scheduler?: boolean
          automation_id?: string | null
          automation_name?: string | null
          automation_trigger?: boolean
          callback_scheduler?: boolean
          color?: string
          created_at?: string
          id?: string
          is_default?: boolean
          min_note_chars?: number
          name?: string
          require_notes?: boolean
          sort_order?: number
          updated_at?: string
          usage_count?: number
        }
        Relationships: []
      }
      dnc_list: {
        Row: {
          added_by: string | null
          created_at: string | null
          id: string
          phone_number: string
          reason: string | null
        }
        Insert: {
          added_by?: string | null
          created_at?: string | null
          id?: string
          phone_number: string
          reason?: string | null
        }
        Update: {
          added_by?: string | null
          created_at?: string | null
          id?: string
          phone_number?: string
          reason?: string | null
        }
        Relationships: []
      }
      goals: {
        Row: {
          created_at: string
          id: string
          metric: string
          period: string
          target_value: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          metric: string
          period: string
          target_value: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          metric?: string
          period?: string
          target_value?: number
          updated_at?: string
        }
        Relationships: []
      }
      import_history: {
        Row: {
          agent_id: string | null
          created_at: string | null
          duplicates: number
          errors: number
          file_name: string
          id: string
          imported: number
          imported_lead_ids: Json | null
          total_records: number
        }
        Insert: {
          agent_id?: string | null
          created_at?: string | null
          duplicates?: number
          errors?: number
          file_name?: string
          id?: string
          imported?: number
          imported_lead_ids?: Json | null
          total_records?: number
        }
        Update: {
          agent_id?: string | null
          created_at?: string | null
          duplicates?: number
          errors?: number
          file_name?: string
          id?: string
          imported?: number
          imported_lead_ids?: Json | null
          total_records?: number
        }
        Relationships: []
      }
      inbound_routing_settings: {
        Row: {
          after_hours_sms: string | null
          after_hours_sms_enabled: boolean
          auto_create_lead: boolean
          created_at: string | null
          id: string
          routing_mode: string
          updated_at: string | null
        }
        Insert: {
          after_hours_sms?: string | null
          after_hours_sms_enabled?: boolean
          auto_create_lead?: boolean
          created_at?: string | null
          id?: string
          routing_mode?: string
          updated_at?: string | null
        }
        Update: {
          after_hours_sms?: string | null
          after_hours_sms_enabled?: boolean
          auto_create_lead?: boolean
          created_at?: string | null
          id?: string
          routing_mode?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      lead_source_costs: {
        Row: {
          cost: number | null
          created_at: string | null
          id: string
          lead_source: string
          notes: string | null
          period: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          cost?: number | null
          created_at?: string | null
          id?: string
          lead_source: string
          notes?: string | null
          period?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          cost?: number | null
          created_at?: string | null
          id?: string
          lead_source?: string
          notes?: string | null
          period?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      leads: {
        Row: {
          age: number | null
          assigned_agent_id: string
          best_time_to_call: string | null
          created_at: string
          custom_fields: Json | null
          date_of_birth: string | null
          email: string
          first_name: string
          health_status: string | null
          id: string
          last_contacted_at: string | null
          last_name: string
          lead_score: number
          lead_source: string
          notes: string | null
          phone: string
          spouse_info: Json | null
          state: string
          status: string
          updated_at: string
        }
        Insert: {
          age?: number | null
          assigned_agent_id?: string
          best_time_to_call?: string | null
          created_at?: string
          custom_fields?: Json | null
          date_of_birth?: string | null
          email?: string
          first_name?: string
          health_status?: string | null
          id?: string
          last_contacted_at?: string | null
          last_name?: string
          lead_score?: number
          lead_source?: string
          notes?: string | null
          phone?: string
          spouse_info?: Json | null
          state?: string
          status?: string
          updated_at?: string
        }
        Update: {
          age?: number | null
          assigned_agent_id?: string
          best_time_to_call?: string | null
          created_at?: string
          custom_fields?: Json | null
          date_of_birth?: string | null
          email?: string
          first_name?: string
          health_status?: string | null
          id?: string
          last_contacted_at?: string | null
          last_name?: string
          lead_score?: number
          lead_source?: string
          notes?: string | null
          phone?: string
          spouse_info?: Json | null
          state?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      message_templates: {
        Row: {
          content: string
          created_at: string
          id: string
          name: string
          subject: string | null
          type: string | null
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          name: string
          subject?: string | null
          type?: string | null
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          name?: string
          subject?: string | null
          type?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          body: string
          created_at: string | null
          created_by: string | null
          direction: string
          from_number: string
          id: string
          lead_id: string | null
          sent_at: string | null
          status: string
          telnyx_message_id: string | null
          to_number: string
        }
        Insert: {
          body: string
          created_at?: string | null
          created_by?: string | null
          direction: string
          from_number: string
          id?: string
          lead_id?: string | null
          sent_at?: string | null
          status?: string
          telnyx_message_id?: string | null
          to_number: string
        }
        Update: {
          body?: string
          created_at?: string | null
          created_by?: string | null
          direction?: string
          from_number?: string
          id?: string
          lead_id?: string | null
          sent_at?: string | null
          status?: string
          telnyx_message_id?: string | null
          to_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          action_label: string | null
          action_url: string | null
          body: string
          created_at: string
          id: string
          metadata: Json | null
          read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          action_label?: string | null
          action_url?: string | null
          body: string
          created_at?: string
          id?: string
          metadata?: Json | null
          read?: boolean
          title: string
          type?: string
          user_id: string
        }
        Update: {
          action_label?: string | null
          action_url?: string | null
          body?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      phone_numbers: {
        Row: {
          area_code: string | null
          assigned_to: string | null
          attestation_level: string | null
          avg_mos: number | null
          avg_quality_percentage: number | null
          carrier_reputation_data: Json | null
          created_at: string | null
          d51_count: number
          daily_call_count: number | null
          daily_call_limit: number | null
          friendly_name: string | null
          id: string
          is_default: boolean | null
          last_rejection_at: string | null
          limit_reset_at: string | null
          phone_number: string
          rejected_calls_30d: number
          rejected_calls_7d: number
          rejection_rate_30d: number
          rejection_rate_7d: number
          shaken_stir_a_count: number
          shaken_stir_rate: number
          shaken_stir_unavailable_count: number
          spam_checked_at: string | null
          spam_score: number | null
          spam_status: string | null
          status: string | null
          total_calls_30d: number
          total_calls_7d: number
          updated_at: string | null
        }
        Insert: {
          area_code?: string | null
          assigned_to?: string | null
          attestation_level?: string | null
          avg_mos?: number | null
          avg_quality_percentage?: number | null
          carrier_reputation_data?: Json | null
          created_at?: string | null
          d51_count?: number
          daily_call_count?: number | null
          daily_call_limit?: number | null
          friendly_name?: string | null
          id?: string
          is_default?: boolean | null
          last_rejection_at?: string | null
          limit_reset_at?: string | null
          phone_number: string
          rejected_calls_30d?: number
          rejected_calls_7d?: number
          rejection_rate_30d?: number
          rejection_rate_7d?: number
          shaken_stir_a_count?: number
          shaken_stir_rate?: number
          shaken_stir_unavailable_count?: number
          spam_checked_at?: string | null
          spam_score?: number | null
          spam_status?: string | null
          status?: string | null
          total_calls_30d?: number
          total_calls_7d?: number
          updated_at?: string | null
        }
        Update: {
          area_code?: string | null
          assigned_to?: string | null
          attestation_level?: string | null
          avg_mos?: number | null
          avg_quality_percentage?: number | null
          carrier_reputation_data?: Json | null
          created_at?: string | null
          d51_count?: number
          daily_call_count?: number | null
          daily_call_limit?: number | null
          friendly_name?: string | null
          id?: string
          is_default?: boolean | null
          last_rejection_at?: string | null
          limit_reset_at?: string | null
          phone_number?: string
          rejected_calls_30d?: number
          rejected_calls_7d?: number
          rejection_rate_30d?: number
          rejection_rate_7d?: number
          shaken_stir_a_count?: number
          shaken_stir_rate?: number
          shaken_stir_unavailable_count?: number
          spam_checked_at?: string | null
          spam_score?: number | null
          spam_status?: string | null
          status?: string | null
          total_calls_30d?: number
          total_calls_7d?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      phone_settings: {
        Row: {
          account_sid: string | null
          amd_enabled: boolean | null
          api_key: string | null
          api_secret: string | null
          application_sid: string | null
          auth_token: string | null
          created_at: string | null
          id: string
          provider: string
          recording_enabled: boolean | null
          recording_retention_days: number | null
          transcription_enabled: boolean | null
          updated_at: string | null
        }
        Insert: {
          account_sid?: string | null
          amd_enabled?: boolean | null
          api_key?: string | null
          api_secret?: string | null
          application_sid?: string | null
          auth_token?: string | null
          created_at?: string | null
          id?: string
          provider?: string
          recording_enabled?: boolean | null
          recording_retention_days?: number | null
          transcription_enabled?: boolean | null
          updated_at?: string | null
        }
        Update: {
          account_sid?: string | null
          amd_enabled?: boolean | null
          api_key?: string | null
          api_secret?: string | null
          application_sid?: string | null
          auth_token?: string | null
          created_at?: string | null
          id?: string
          provider?: string
          recording_enabled?: boolean | null
          recording_retention_days?: number | null
          transcription_enabled?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      pipeline_stages: {
        Row: {
          color: string
          convert_to_client: boolean
          created_at: string
          id: string
          is_default: boolean
          is_positive: boolean
          name: string
          pipeline_type: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          color?: string
          convert_to_client?: boolean
          created_at?: string
          id?: string
          is_default?: boolean
          is_positive?: boolean
          name: string
          pipeline_type?: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          color?: string
          convert_to_client?: boolean
          created_at?: string
          id?: string
          is_default?: boolean
          is_positive?: boolean
          name?: string
          pipeline_type?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          auto_dial_preference: boolean | null
          availability_status: string
          avatar_url: string | null
          carriers: Json | null
          commission_level: string | null
          created_at: string
          email: string
          email_notifications_enabled: boolean | null
          first_name: string
          id: string
          last_name: string
          licensed_states: Json | null
          local_presence_enabled: boolean | null
          npn: string | null
          phone: string | null
          push_notifications_enabled: boolean | null
          resident_state: string | null
          role: string
          sms_notifications_enabled: boolean | null
          status: string
          theme_preference: string
          timezone: string | null
          updated_at: string
          win_sound_enabled: boolean | null
        }
        Insert: {
          auto_dial_preference?: boolean | null
          availability_status?: string
          avatar_url?: string | null
          carriers?: Json | null
          commission_level?: string | null
          created_at?: string
          email?: string
          email_notifications_enabled?: boolean | null
          first_name?: string
          id: string
          last_name?: string
          licensed_states?: Json | null
          local_presence_enabled?: boolean | null
          npn?: string | null
          phone?: string | null
          push_notifications_enabled?: boolean | null
          resident_state?: string | null
          role?: string
          sms_notifications_enabled?: boolean | null
          status?: string
          theme_preference?: string
          timezone?: string | null
          updated_at?: string
          win_sound_enabled?: boolean | null
        }
        Update: {
          auto_dial_preference?: boolean | null
          availability_status?: string
          avatar_url?: string | null
          carriers?: Json | null
          commission_level?: string | null
          created_at?: string
          email?: string
          email_notifications_enabled?: boolean | null
          first_name?: string
          id?: string
          last_name?: string
          licensed_states?: Json | null
          local_presence_enabled?: boolean | null
          npn?: string | null
          phone?: string | null
          push_notifications_enabled?: boolean | null
          resident_state?: string | null
          role?: string
          sms_notifications_enabled?: boolean | null
          status?: string
          theme_preference?: string
          timezone?: string | null
          updated_at?: string
          win_sound_enabled?: boolean | null
        }
        Relationships: []
      }
      recruits: {
        Row: {
          assigned_agent_id: string
          created_at: string
          email: string
          first_name: string
          id: string
          last_name: string
          notes: string | null
          phone: string
          status: string
          updated_at: string
        }
        Insert: {
          assigned_agent_id?: string
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          notes?: string | null
          phone?: string
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_agent_id?: string
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          notes?: string | null
          phone?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      saved_reports: {
        Row: {
          config: Json
          created_at: string | null
          created_by: string | null
          id: string
          name: string
          updated_at: string | null
        }
        Insert: {
          config?: Json
          created_at?: string | null
          created_by?: string | null
          id?: string
          name: string
          updated_at?: string | null
        }
        Update: {
          config?: Json
          created_at?: string | null
          created_by?: string | null
          id?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      scheduled_reports: {
        Row: {
          agent_filter: string | null
          created_at: string | null
          created_by: string | null
          day_of_month: number | null
          day_of_week: number | null
          enabled: boolean | null
          frequency: string
          id: string
          last_sent_at: string | null
          name: string
          recipients: Json | null
          report_sections: Json | null
          time_of_day: string | null
          updated_at: string | null
        }
        Insert: {
          agent_filter?: string | null
          created_at?: string | null
          created_by?: string | null
          day_of_month?: number | null
          day_of_week?: number | null
          enabled?: boolean | null
          frequency: string
          id?: string
          last_sent_at?: string | null
          name: string
          recipients?: Json | null
          report_sections?: Json | null
          time_of_day?: string | null
          updated_at?: string | null
        }
        Update: {
          agent_filter?: string | null
          created_at?: string | null
          created_by?: string | null
          day_of_month?: number | null
          day_of_week?: number | null
          enabled?: boolean | null
          frequency?: string
          id?: string
          last_sent_at?: string | null
          name?: string
          recipients?: Json | null
          report_sections?: Json | null
          time_of_day?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      telnyx_settings: {
        Row: {
          api_key: string | null
          connection_id: string | null
          id: string
          sip_password: string | null
          sip_username: string | null
          updated_at: string | null
        }
        Insert: {
          api_key?: string | null
          connection_id?: string | null
          id?: string
          sip_password?: string | null
          sip_username?: string | null
          updated_at?: string | null
        }
        Update: {
          api_key?: string | null
          connection_id?: string | null
          id?: string
          sip_password?: string | null
          sip_username?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          id: string
          preference_key: string
          preference_value: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          id?: string
          preference_key: string
          preference_value: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          id?: string
          preference_key?: string
          preference_value?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      wins: {
        Row: {
          agent_id: string | null
          agent_name: string | null
          call_id: string | null
          campaign_id: string | null
          campaign_name: string | null
          celebrated: boolean | null
          contact_id: string | null
          contact_name: string | null
          created_at: string | null
          id: string
          notes: string | null
          policy_type: string | null
        }
        Insert: {
          agent_id?: string | null
          agent_name?: string | null
          call_id?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          celebrated?: boolean | null
          contact_id?: string | null
          contact_name?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          policy_type?: string | null
        }
        Update: {
          agent_id?: string | null
          agent_name?: string | null
          call_id?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          celebrated?: boolean | null
          contact_id?: string | null
          contact_name?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          policy_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wins_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wins_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
