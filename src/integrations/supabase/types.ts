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
          organization_id: string | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          organization_id?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          organization_id?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          organization_id: string | null
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
          organization_id?: string | null
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
          organization_id?: string | null
          policies_sold?: number | null
          talk_time?: number | null
          week_end?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_scorecards_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      app_config: {
        Row: {
          key: string
          value: string | null
        }
        Insert: {
          key: string
          value?: string | null
        }
        Update: {
          key?: string
          value?: string | null
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
          organization_id: string | null
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
          organization_id?: string | null
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
          organization_id?: string | null
          start_time?: string
          status?: string
          sync_source?: string
          title?: string
          type?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          organization_id: string | null
          updated_at: string | null
        }
        Insert: {
          close_time?: string | null
          created_at?: string | null
          day_of_week: number
          id?: string
          is_open?: boolean | null
          open_time?: string | null
          organization_id?: string | null
          updated_at?: string | null
        }
        Update: {
          close_time?: string | null
          created_at?: string | null
          day_of_week?: number
          id?: string
          is_open?: boolean | null
          open_time?: string | null
          organization_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_hours_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
      call_logs: {
        Row: {
          created_at: string
          direction: string
          duration: number
          id: string
          lead_id: string | null
          organization_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          direction: string
          duration?: number
          id?: string
          lead_id?: string | null
          organization_id?: string | null
          status: string
          user_id?: string
        }
        Update: {
          created_at?: string
          direction?: string
          duration?: number
          id?: string
          lead_id?: string | null
          organization_id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      call_scripts: {
        Row: {
          active: boolean | null
          content: string | null
          created_at: string | null
          id: string
          name: string
          organization_id: string | null
          product_type: string
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          content?: string | null
          created_at?: string | null
          id?: string
          name: string
          organization_id?: string | null
          product_type: string
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          content?: string | null
          created_at?: string | null
          id?: string
          name?: string
          organization_id?: string | null
          product_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_scripts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          is_missed: boolean | null
          lead_id: string | null
          mos: number | null
          notes: string | null
          organization_id: string | null
          outcome: string | null
          pdd_seconds: number | null
          quality_percentage: number | null
          recording_duration: number | null
          recording_storage_path: string | null
          recording_url: string | null
          shaken_stir: string | null
          sip_response_code: number | null
          started_at: string | null
          status: string | null
          provider_error_code: string | null
          provider_session_id: string | null
          transcript: Json | null
          twilio_call_sid: string | null
          updated_at: string | null
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
          is_missed?: boolean | null
          lead_id?: string | null
          mos?: number | null
          notes?: string | null
          organization_id?: string | null
          outcome?: string | null
          pdd_seconds?: number | null
          quality_percentage?: number | null
          recording_duration?: number | null
          recording_storage_path?: string | null
          recording_url?: string | null
          shaken_stir?: string | null
          sip_response_code?: number | null
          started_at?: string | null
          status?: string | null
          provider_error_code?: string | null
          provider_session_id?: string | null
          transcript?: Json | null
          twilio_call_sid?: string | null
          updated_at?: string | null
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
          is_missed?: boolean | null
          lead_id?: string | null
          mos?: number | null
          notes?: string | null
          organization_id?: string | null
          outcome?: string | null
          pdd_seconds?: number | null
          quality_percentage?: number | null
          recording_duration?: number | null
          recording_storage_path?: string | null
          recording_url?: string | null
          shaken_stir?: string | null
          sip_response_code?: number | null
          started_at?: string | null
          status?: string | null
          provider_error_code?: string | null
          provider_session_id?: string | null
          transcript?: Json | null
          twilio_call_sid?: string | null
          updated_at?: string | null
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
          {
            foreignKeyName: "calls_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_leads: {
        Row: {
          age: number | null
          call_attempts: number | null
          callback_due_at: string | null
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
          organization_id: string | null
          phone: string | null
          retry_eligible_at: string | null
          scheduled_callback_at: string | null
          sort_order: number | null
          source: string | null
          state: string | null
          status: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          age?: number | null
          call_attempts?: number | null
          callback_due_at?: string | null
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
          organization_id?: string | null
          phone?: string | null
          retry_eligible_at?: string | null
          scheduled_callback_at?: string | null
          sort_order?: number | null
          source?: string | null
          state?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          age?: number | null
          call_attempts?: number | null
          callback_due_at?: string | null
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
          organization_id?: string | null
          phone?: string | null
          retry_eligible_at?: string | null
          scheduled_callback_at?: string | null
          sort_order?: number | null
          source?: string | null
          state?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
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
          {
            foreignKeyName: "campaign_leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          organization_id: string | null
          retry_interval_hours: number | null
          ring_timeout_seconds: number | null
          status: string
          tags: Json | null
          total_leads: number | null
          type: string
          updated_at: string | null
          user_id: string | null
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
          organization_id?: string | null
          retry_interval_hours?: number | null
          ring_timeout_seconds?: number | null
          status?: string
          tags?: Json | null
          total_leads?: number | null
          type?: string
          updated_at?: string | null
          user_id?: string | null
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
          organization_id?: string | null
          retry_interval_hours?: number | null
          ring_timeout_seconds?: number | null
          status?: string
          tags?: Json | null
          total_leads?: number | null
          type?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      carriers: {
        Row: {
          contact_emails: Json
          contact_phones: Json
          created_at: string
          id: string
          is_appointed: boolean | null
          logo_url: string | null
          name: string
          organization_id: string | null
          portal_url: string | null
          updated_at: string
        }
        Insert: {
          contact_emails?: Json
          contact_phones?: Json
          created_at?: string
          id?: string
          is_appointed?: boolean | null
          logo_url?: string | null
          name: string
          organization_id?: string | null
          portal_url?: string | null
          updated_at?: string
        }
        Update: {
          contact_emails?: Json
          contact_phones?: Json
          created_at?: string
          id?: string
          is_appointed?: boolean | null
          logo_url?: string | null
          name?: string
          organization_id?: string | null
          portal_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "carriers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          organization_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          organization_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          organization_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_groups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          assigned_agent_id: string | null
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
          organization_id: string | null
          phone: string
          policy_number: string | null
          policy_type: string
          premium: number | null
          premium_amount: number | null
          state: string | null
          updated_at: string
        }
        Insert: {
          assigned_agent_id?: string | null
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
          organization_id?: string | null
          phone?: string
          policy_number?: string | null
          policy_type?: string
          premium?: number | null
          premium_amount?: number | null
          state?: string | null
          updated_at?: string
        }
        Update: {
          assigned_agent_id?: string | null
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
          organization_id?: string | null
          phone?: string
          policy_number?: string | null
          policy_type?: string
          premium?: number | null
          premium_amount?: number | null
          state?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_assigned_agent_id_fkey"
            columns: ["assigned_agent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          leaderboard_tv_banner_text: string | null
          logo_name: string | null
          logo_url: string | null
          organization_id: string | null
          primary_color: string | null
          time_format: string | null
          timezone: string | null
          updated_at: string
          website_url: string | null
        }
        Insert: {
          company_name: string
          company_phone?: string | null
          created_at?: string
          date_format?: string | null
          favicon_name?: string | null
          favicon_url?: string | null
          id?: string
          leaderboard_tv_banner_text?: string | null
          logo_name?: string | null
          logo_url?: string | null
          organization_id?: string | null
          primary_color?: string | null
          time_format?: string | null
          timezone?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          company_name?: string
          company_phone?: string | null
          created_at?: string
          date_format?: string | null
          favicon_name?: string | null
          favicon_url?: string | null
          id?: string
          leaderboard_tv_banner_text?: string | null
          logo_name?: string | null
          logo_url?: string | null
          organization_id?: string | null
          primary_color?: string | null
          time_format?: string | null
          timezone?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          organization_id: string | null
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
          organization_id?: string | null
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
          organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_activities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_management_settings: {
        Row: {
          assignment_method: string
          assignment_rotation: Json
          assignment_specific_agent_id: string | null
          created_at: string
          csv_action: string
          duplicate_detection_rule: string
          duplicate_detection_scope: string
          id: string
          import_method: string
          import_override: boolean
          import_rotation: Json
          import_specific_agent_id: string | null
          manual_action: string
          organization_id: string
          required_fields_client: Json
          required_fields_lead: Json
          updated_at: string
        }
        Insert: {
          assignment_method?: string
          assignment_rotation?: Json
          assignment_specific_agent_id?: string | null
          created_at?: string
          csv_action?: string
          duplicate_detection_rule?: string
          duplicate_detection_scope?: string
          id?: string
          import_method?: string
          import_override?: boolean
          import_rotation?: Json
          import_specific_agent_id?: string | null
          manual_action?: string
          organization_id: string
          required_fields_client?: Json
          required_fields_lead?: Json
          updated_at?: string
        }
        Update: {
          assignment_method?: string
          assignment_rotation?: Json
          assignment_specific_agent_id?: string | null
          created_at?: string
          csv_action?: string
          duplicate_detection_rule?: string
          duplicate_detection_scope?: string
          id?: string
          import_method?: string
          import_override?: boolean
          import_rotation?: Json
          import_specific_agent_id?: string | null
          manual_action?: string
          organization_id?: string
          required_fields_client?: Json
          required_fields_lead?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_management_settings_assignment_specific_agent_id_fkey"
            columns: ["assignment_specific_agent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_management_settings_import_specific_agent_id_fkey"
            columns: ["import_specific_agent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_management_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_notes: {
        Row: {
          author_id: string | null
          contact_id: string
          contact_type: string
          content: string
          created_at: string
          id: string
          organization_id: string | null
          pinned: boolean
        }
        Insert: {
          author_id?: string | null
          contact_id: string
          contact_type?: string
          content?: string
          created_at?: string
          id?: string
          organization_id?: string | null
          pinned?: boolean
        }
        Update: {
          author_id?: string | null
          contact_id?: string
          contact_type?: string
          content?: string
          created_at?: string
          id?: string
          organization_id?: string | null
          pinned?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "contact_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_fields: {
        Row: {
          active: boolean | null
          applies_to: Json
          created_at: string | null
          default_value: string | null
          dropdown_options: Json | null
          id: string
          name: string
          organization_id: string | null
          required: boolean | null
          type: string
          updated_at: string | null
          usage_count: number | null
        }
        Insert: {
          active?: boolean | null
          applies_to?: Json
          created_at?: string | null
          default_value?: string | null
          dropdown_options?: Json | null
          id?: string
          name: string
          organization_id?: string | null
          required?: boolean | null
          type: string
          updated_at?: string | null
          usage_count?: number | null
        }
        Update: {
          active?: boolean | null
          applies_to?: Json
          created_at?: string | null
          default_value?: string | null
          dropdown_options?: Json | null
          id?: string
          name?: string
          organization_id?: string | null
          required?: boolean | null
          type?: string
          updated_at?: string | null
          usage_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_fields_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_menu_links: {
        Row: {
          created_at: string
          icon: string | null
          id: string
          label: string
          open_mode: string
          organization_id: string | null
          sort_order: number | null
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          icon?: string | null
          id?: string
          label: string
          open_mode?: string
          organization_id?: string | null
          sort_order?: number | null
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          icon?: string | null
          id?: string
          label?: string
          open_mode?: string
          organization_id?: string | null
          sort_order?: number | null
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_menu_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dialer_daily_stats: {
        Row: {
          agent_id: string
          amd_skipped: number
          calls_connected: number
          calls_made: number
          id: string
          last_updated_at: string
          policies_sold: number
          session_duration_seconds: number
          session_started_at: string | null
          stat_date: string
          total_talk_seconds: number
        }
        Insert: {
          agent_id: string
          amd_skipped?: number
          calls_connected?: number
          calls_made?: number
          id?: string
          last_updated_at?: string
          policies_sold?: number
          session_duration_seconds?: number
          session_started_at?: string | null
          stat_date?: string
          total_talk_seconds?: number
        }
        Update: {
          agent_id?: string
          amd_skipped?: number
          calls_connected?: number
          calls_made?: number
          id?: string
          last_updated_at?: string
          policies_sold?: number
          session_duration_seconds?: number
          session_started_at?: string | null
          stat_date?: string
          total_talk_seconds?: number
        }
        Relationships: []
      }
      dialer_lead_locks: {
        Row: {
          campaign_id: string
          campaign_lead_id: string
          expires_at: string
          id: string
          locked_at: string
          locked_by: string
          organization_id: string
        }
        Insert: {
          campaign_id: string
          campaign_lead_id: string
          expires_at: string
          id?: string
          locked_at?: string
          locked_by: string
          organization_id: string
        }
        Update: {
          campaign_id?: string
          campaign_lead_id?: string
          expires_at?: string
          id?: string
          locked_at?: string
          locked_by?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dialer_lead_locks_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dialer_lead_locks_campaign_lead_id_fkey"
            columns: ["campaign_lead_id"]
            isOneToOne: true
            referencedRelation: "campaign_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      dialer_queue_state: {
        Row: {
          campaign_id: string
          current_lead_id: string | null
          id: string
          queue_index: number
          updated_at: string
          user_id: string
        }
        Insert: {
          campaign_id: string
          current_lead_id?: string | null
          id?: string
          queue_index?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          campaign_id?: string
          current_lead_id?: string | null
          id?: string
          queue_index?: number
          updated_at?: string
          user_id?: string
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
          organization_id: string | null
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
          organization_id?: string | null
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
          organization_id?: string | null
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
          {
            foreignKeyName: "dialer_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dispositions: {
        Row: {
          appointment_scheduler: boolean
          auto_add_to_dnc: boolean
          automation_id: string | null
          automation_name: string | null
          automation_trigger: boolean
          callback_scheduler: boolean
          campaign_action: string
          color: string
          created_at: string
          dnc_auto_add: boolean
          id: string
          is_locked: boolean
          min_note_chars: number
          name: string
          organization_id: string | null
          remove_from_queue: boolean
          require_notes: boolean
          sort_order: number
          updated_at: string
          usage_count: number
        }
        Insert: {
          appointment_scheduler?: boolean
          auto_add_to_dnc?: boolean
          automation_id?: string | null
          automation_name?: string | null
          automation_trigger?: boolean
          callback_scheduler?: boolean
          campaign_action?: string
          color?: string
          created_at?: string
          dnc_auto_add?: boolean
          id?: string
          is_locked?: boolean
          min_note_chars?: number
          name: string
          organization_id?: string | null
          remove_from_queue?: boolean
          require_notes?: boolean
          sort_order?: number
          updated_at?: string
          usage_count?: number
        }
        Update: {
          appointment_scheduler?: boolean
          auto_add_to_dnc?: boolean
          automation_id?: string | null
          automation_name?: string | null
          automation_trigger?: boolean
          callback_scheduler?: boolean
          campaign_action?: string
          color?: string
          created_at?: string
          dnc_auto_add?: boolean
          id?: string
          is_locked?: boolean
          min_note_chars?: number
          name?: string
          organization_id?: string | null
          remove_from_queue?: boolean
          require_notes?: boolean
          sort_order?: number
          updated_at?: string
          usage_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "dispositions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dnc_list: {
        Row: {
          added_by: string | null
          created_at: string | null
          id: string
          organization_id: string | null
          phone_number: string
          reason: string | null
        }
        Insert: {
          added_by?: string | null
          created_at?: string | null
          id?: string
          organization_id?: string | null
          phone_number: string
          reason?: string | null
        }
        Update: {
          added_by?: string | null
          created_at?: string | null
          id?: string
          organization_id?: string | null
          phone_number?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dnc_list_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          created_at: string
          id: string
          metric: string
          organization_id: string | null
          period: string
          target_value: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          metric: string
          organization_id?: string | null
          period: string
          target_value: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          metric?: string
          organization_id?: string | null
          period?: string
          target_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "goals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      health_statuses: {
        Row: {
          color: string
          created_at: string | null
          description: string | null
          id: string
          is_default: boolean | null
          name: string
          organization_id: string | null
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          color?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          organization_id?: string | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          color?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          organization_id?: string | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "health_statuses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      import_history: {
        Row: {
          agent_id: string | null
          campaign_id: string | null
          created_at: string | null
          duplicates: number
          errors: number
          file_name: string
          id: string
          imported: number
          imported_lead_ids: Json | null
          organization_id: string | null
          total_records: number
        }
        Insert: {
          agent_id?: string | null
          campaign_id?: string | null
          created_at?: string | null
          duplicates?: number
          errors?: number
          file_name?: string
          id?: string
          imported?: number
          imported_lead_ids?: Json | null
          organization_id?: string | null
          total_records?: number
        }
        Update: {
          agent_id?: string | null
          campaign_id?: string | null
          created_at?: string | null
          duplicates?: number
          errors?: number
          file_name?: string
          id?: string
          imported?: number
          imported_lead_ids?: Json | null
          organization_id?: string | null
          total_records?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_history_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
      invitations: {
        Row: {
          commission_level: string | null
          created_at: string
          email: string
          expires_at: string
          first_name: string | null
          id: string
          invited_by: string | null
          last_name: string | null
          licensed_states: Json
          organization_id: string
          role: string
          status: string
          team_id: string | null
          token: string
          upline_id: string | null
        }
        Insert: {
          commission_level?: string | null
          created_at?: string
          email: string
          expires_at?: string
          first_name?: string | null
          id?: string
          invited_by?: string | null
          last_name?: string | null
          licensed_states?: Json
          organization_id: string
          role?: string
          status?: string
          team_id?: string | null
          token?: string
          upline_id?: string | null
        }
        Update: {
          commission_level?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          first_name?: string | null
          id?: string
          invited_by?: string | null
          last_name?: string | null
          licensed_states?: Json
          organization_id?: string
          role?: string
          status?: string
          team_id?: string | null
          token?: string
          upline_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_upline_id_fkey"
            columns: ["upline_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_source_costs: {
        Row: {
          cost: number | null
          created_at: string | null
          id: string
          lead_source: string
          notes: string | null
          organization_id: string | null
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
          organization_id?: string | null
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
          organization_id?: string | null
          period?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_source_costs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_sources: {
        Row: {
          active: boolean | null
          color: string
          created_at: string | null
          id: string
          name: string
          organization_id: string | null
          sort_order: number | null
          updated_at: string | null
          usage_count: number | null
        }
        Insert: {
          active?: boolean | null
          color?: string
          created_at?: string | null
          id?: string
          name: string
          organization_id?: string | null
          sort_order?: number | null
          updated_at?: string | null
          usage_count?: number | null
        }
        Update: {
          active?: boolean | null
          color?: string
          created_at?: string | null
          id?: string
          name?: string
          organization_id?: string | null
          sort_order?: number | null
          updated_at?: string | null
          usage_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_sources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          age: number | null
          assigned_agent_id: string | null
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
          organization_id: string | null
          phone: string
          spouse_info: Json | null
          state: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          age?: number | null
          assigned_agent_id?: string | null
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
          organization_id?: string | null
          phone?: string
          spouse_info?: Json | null
          state?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          age?: number | null
          assigned_agent_id?: string | null
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
          organization_id?: string | null
          phone?: string
          spouse_info?: Json | null
          state?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          attachments: Json | null
          category: string | null
          content: string
          created_at: string
          id: string
          name: string
          organization_id: string | null
          subject: string | null
          type: string | null
          updated_at: string
        }
        Insert: {
          attachments?: Json | null
          category?: string | null
          content: string
          created_at?: string
          id?: string
          name: string
          organization_id?: string | null
          subject?: string | null
          type?: string | null
          updated_at?: string
        }
        Update: {
          attachments?: Json | null
          category?: string | null
          content?: string
          created_at?: string
          id?: string
          name?: string
          organization_id?: string | null
          subject?: string | null
          type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          organization_id: string | null
          sent_at: string | null
          status: string
          provider_message_id: string | null
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
          organization_id?: string | null
          sent_at?: string | null
          status?: string
          provider_message_id?: string | null
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
          organization_id?: string | null
          sent_at?: string | null
          status?: string
          provider_message_id?: string | null
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
          {
            foreignKeyName: "messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          organization_id: string | null
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
          organization_id?: string | null
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
          organization_id?: string | null
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string | null
          id: string
          logo_url: string | null
          name: string
          slug: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          logo_url?: string | null
          name: string
          slug?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          slug?: string | null
          updated_at?: string | null
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
          organization_id: string | null
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
          organization_id?: string | null
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
          organization_id?: string | null
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
        Relationships: [
          {
            foreignKeyName: "phone_numbers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          organization_id: string | null
          provider: string
          recording_enabled: boolean | null
          recording_retention_days: number | null
          ring_timeout: number | null
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
          organization_id?: string | null
          provider?: string
          recording_enabled?: boolean | null
          recording_retention_days?: number | null
          ring_timeout?: number | null
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
          organization_id?: string | null
          provider?: string
          recording_enabled?: boolean | null
          recording_retention_days?: number | null
          ring_timeout?: number | null
          transcription_enabled?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "phone_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          organization_id: string | null
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
          organization_id?: string | null
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
          organization_id?: string | null
          pipeline_type?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          hierarchy_path: unknown
          id: string
          is_super_admin: boolean | null
          last_login_at: string | null
          last_name: string
          licensed_states: Json | null
          local_presence_enabled: boolean | null
          monthly_call_goal: number | null
          monthly_policies_goal: number | null
          monthly_talk_time_goal: number | null
          monthly_talk_time_goal_hours: number | null
          npn: string | null
          organization_id: string | null
          phone: string | null
          push_notifications_enabled: boolean | null
          resident_state: string | null
          role: string
          sip_username: string | null
          sms_notifications_enabled: boolean | null
          status: string
          team_id: string | null
          theme_preference: string
          timezone: string | null
          updated_at: string
          upline_id: string | null
          weekly_appointment_goal: number | null
          weekly_appointments_goal: number | null
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
          hierarchy_path?: unknown
          id: string
          is_super_admin?: boolean | null
          last_login_at?: string | null
          last_name?: string
          licensed_states?: Json | null
          local_presence_enabled?: boolean | null
          monthly_call_goal?: number | null
          monthly_policies_goal?: number | null
          monthly_talk_time_goal?: number | null
          monthly_talk_time_goal_hours?: number | null
          npn?: string | null
          organization_id?: string | null
          phone?: string | null
          push_notifications_enabled?: boolean | null
          resident_state?: string | null
          role?: string
          sip_username?: string | null
          sms_notifications_enabled?: boolean | null
          status?: string
          team_id?: string | null
          theme_preference?: string
          timezone?: string | null
          updated_at?: string
          upline_id?: string | null
          weekly_appointment_goal?: number | null
          weekly_appointments_goal?: number | null
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
          hierarchy_path?: unknown
          id?: string
          is_super_admin?: boolean | null
          last_login_at?: string | null
          last_name?: string
          licensed_states?: Json | null
          local_presence_enabled?: boolean | null
          monthly_call_goal?: number | null
          monthly_policies_goal?: number | null
          monthly_talk_time_goal?: number | null
          monthly_talk_time_goal_hours?: number | null
          npn?: string | null
          organization_id?: string | null
          phone?: string | null
          push_notifications_enabled?: boolean | null
          resident_state?: string | null
          role?: string
          sip_username?: string | null
          sms_notifications_enabled?: boolean | null
          status?: string
          team_id?: string | null
          theme_preference?: string
          timezone?: string | null
          updated_at?: string
          upline_id?: string | null
          weekly_appointment_goal?: number | null
          weekly_appointments_goal?: number | null
          win_sound_enabled?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_upline_id_fkey"
            columns: ["upline_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      recruits: {
        Row: {
          assigned_agent_id: string | null
          created_at: string
          email: string
          first_name: string
          id: string
          last_name: string
          notes: string | null
          organization_id: string | null
          phone: string
          state: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assigned_agent_id?: string | null
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          notes?: string | null
          organization_id?: string | null
          phone?: string
          state?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_agent_id?: string | null
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          notes?: string | null
          organization_id?: string | null
          phone?: string
          state?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recruits_assigned_agent_id_fkey"
            columns: ["assigned_agent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruits_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_reports: {
        Row: {
          config: Json
          created_at: string | null
          created_by: string | null
          id: string
          name: string
          organization_id: string | null
          updated_at: string | null
        }
        Insert: {
          config?: Json
          created_at?: string | null
          created_by?: string | null
          id?: string
          name: string
          organization_id?: string | null
          updated_at?: string | null
        }
        Update: {
          config?: Json
          created_at?: string | null
          created_by?: string | null
          id?: string
          name?: string
          organization_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "saved_reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          organization_id: string | null
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
          organization_id?: string | null
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
          organization_id?: string | null
          recipients?: Json | null
          report_sections?: Json | null
          time_of_day?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string | null
          id: string
          name: string
          organization_id: string
          parent_team_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          organization_id: string
          parent_team_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          organization_id?: string
          parent_team_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teams_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_parent_team_id_fkey"
            columns: ["parent_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          created_at: string | null
          id: string
          settings: Json
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          settings?: Json
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          settings?: Json
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      webhook_debug_log: {
        Row: {
          call_control_id: string | null
          created_at: string | null
          event_type: string | null
          id: string
          payload_direction: string | null
          payload_from: string | null
          payload_to: string | null
          raw_body_preview: string | null
        }
        Insert: {
          call_control_id?: string | null
          created_at?: string | null
          event_type?: string | null
          id?: string
          payload_direction?: string | null
          payload_from?: string | null
          payload_to?: string | null
          raw_body_preview?: string | null
        }
        Update: {
          call_control_id?: string | null
          created_at?: string | null
          event_type?: string | null
          id?: string
          payload_direction?: string | null
          payload_from?: string | null
          payload_to?: string | null
          raw_body_preview?: string | null
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
          organization_id: string | null
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
          organization_id?: string | null
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
          organization_id?: string | null
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
          {
            foreignKeyName: "wins_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_leads_to_campaign: {
        Args: { p_campaign_id: string; p_lead_ids: string[] }
        Returns: Json
      }
      compute_hierarchy_path: {
        Args: { target_user_id: string }
        Returns: unknown
      }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      fetch_and_lock_next_lead: {
        Args: { p_campaign_id: string; p_filters?: Json }
        Returns: {
          age: number | null
          call_attempts: number | null
          callback_due_at: string | null
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
          organization_id: string | null
          phone: string | null
          retry_eligible_at: string | null
          scheduled_callback_at: string | null
          sort_order: number | null
          source: string | null
          state: string | null
          status: string | null
          updated_at: string | null
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "campaign_leads"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_enterprise_queue_leads: {
        Args: {
          p_campaign_id: string
          p_limit: number
          p_offset: number
          p_org_id: string
        }
        Returns: {
          age: number | null
          call_attempts: number | null
          callback_due_at: string | null
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
          organization_id: string | null
          phone: string | null
          retry_eligible_at: string | null
          scheduled_callback_at: string | null
          sort_order: number | null
          source: string | null
          state: string | null
          status: string | null
          updated_at: string | null
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "campaign_leads"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_invitation_by_token_rpc: {
        Args: { invite_token: string }
        Returns: {
          accepted_at: string
          commission_level: string
          created_at: string
          email: string
          expires_at: string
          first_name: string
          id: string
          last_name: string
          licensed_states: Json
          org_name: string
          organization_id: string
          role: string
          status: string
          token: string
          upline_id: string
        }[]
      }
      get_org_id: { Args: never; Returns: string }
      get_user_org: { Args: never; Returns: string }
      get_user_org_id: { Args: never; Returns: string }
      get_user_role: { Args: never; Returns: string }
      get_user_team_id: { Args: never; Returns: string }
      increment_dialer_stats:
        | {
            Args: {
              p_agent_id: string
              p_amd_skipped?: number
              p_calls_connected?: number
              p_calls_made?: number
              p_policies_sold?: number
              p_session_started_at?: string
              p_total_talk_seconds?: number
            }
            Returns: undefined
          }
        | {
            Args: {
              p_agent_id: string
              p_amd_skipped?: number
              p_calls_connected?: number
              p_calls_made?: number
              p_policies_sold?: number
              p_session_duration_seconds?: number
              p_session_started_at?: string
              p_total_talk_seconds?: number
            }
            Returns: undefined
          }
      increment_phone_number_daily_usage: {
        Args: { p_phone_e164: string }
        Returns: undefined
      }
      is_admin: { Args: never; Returns: boolean }
      is_ancestor_of: {
        Args: { ancestor_id: string; descendant_id: string }
        Returns: boolean
      }
      is_super_admin: { Args: never; Returns: boolean }
      is_team_leader: { Args: never; Returns: boolean }
      list_unrestricted_users: {
        Args: never
        Returns: {
          auto_dial_preference: boolean | null
          availability_status: string
          avatar_url: string | null
          carriers: Json | null
          commission_level: string | null
          created_at: string
          email: string
          email_notifications_enabled: boolean | null
          first_name: string
          hierarchy_path: unknown
          id: string
          is_super_admin: boolean | null
          last_login_at: string | null
          last_name: string
          licensed_states: Json | null
          local_presence_enabled: boolean | null
          monthly_call_goal: number | null
          monthly_policies_goal: number | null
          monthly_talk_time_goal: number | null
          monthly_talk_time_goal_hours: number | null
          npn: string | null
          organization_id: string | null
          phone: string | null
          push_notifications_enabled: boolean | null
          resident_state: string | null
          role: string
          sip_username: string | null
          sms_notifications_enabled: boolean | null
          status: string
          team_id: string | null
          theme_preference: string
          timezone: string | null
          updated_at: string
          upline_id: string | null
          weekly_appointment_goal: number | null
          weekly_appointments_goal: number | null
          win_sound_enabled: boolean | null
        }[]
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      peek_inbound_call_identity: {
        Args: { p_twilio_call_sid?: string; p_provider_session_id?: string }
        Returns: Json
      }
      release_all_agent_locks: {
        Args: { p_campaign_id: string }
        Returns: undefined
      }
      release_lead_lock: {
        Args: { p_campaign_lead_id: string }
        Returns: undefined
      }
      resolve_inbound_caller_display_name: {
        Args: { p_caller_phone: string }
        Returns: string
      }
      set_claim: {
        Args: { claim: string; uid: string; value: Json }
        Returns: string
      }
      text2ltree: { Args: { "": string }; Returns: unknown }
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
