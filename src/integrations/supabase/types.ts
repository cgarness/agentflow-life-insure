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
      appointments: {
        Row: {
          contact_id: string | null
          contact_name: string | null
          created_at: string | null
          created_by: string | null
          end_time: string | null
          id: string
          notes: string | null
          start_time: string
          status: string
          title: string
          type: string
          updated_at: string | null
        }
        Insert: {
          contact_id?: string | null
          contact_name?: string | null
          created_at?: string | null
          created_by?: string | null
          end_time?: string | null
          id?: string
          notes?: string | null
          start_time: string
          status?: string
          title: string
          type?: string
          updated_at?: string | null
        }
        Update: {
          contact_id?: string | null
          contact_name?: string | null
          created_at?: string | null
          created_by?: string | null
          end_time?: string | null
          id?: string
          notes?: string | null
          start_time?: string
          status?: string
          title?: string
          type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      clients: {
        Row: {
          assigned_agent_id: string | null
          beneficiary_name: string | null
          beneficiary_phone: string | null
          beneficiary_relationship: string | null
          carrier: string | null
          created_at: string | null
          email: string
          first_name: string
          id: string
          last_name: string
          notes: string | null
          phone: string | null
          policy_number: string | null
          policy_type: string | null
          premium: number | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          assigned_agent_id?: string | null
          beneficiary_name?: string | null
          beneficiary_phone?: string | null
          beneficiary_relationship?: string | null
          carrier?: string | null
          created_at?: string | null
          email: string
          first_name: string
          id?: string
          last_name: string
          notes?: string | null
          phone?: string | null
          policy_number?: string | null
          policy_type?: string | null
          premium?: number | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          assigned_agent_id?: string | null
          beneficiary_name?: string | null
          beneficiary_phone?: string | null
          beneficiary_relationship?: string | null
          carrier?: string | null
          created_at?: string | null
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          notes?: string | null
          phone?: string | null
          policy_number?: string | null
          policy_type?: string | null
          premium?: number | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_assigned_agent_id_fkey"
            columns: ["assigned_agent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      contact_activities: {
        Row: {
          activity_type: string
          agent_id: string | null
          contact_id: string
          contact_type: string
          created_at: string | null
          description: string
          id: string
          metadata: Json | null
        }
        Insert: {
          activity_type: string
          agent_id?: string | null
          contact_id: string
          contact_type: string
          created_at?: string | null
          description: string
          id?: string
          metadata?: Json | null
        }
        Update: {
          activity_type?: string
          agent_id?: string | null
          contact_id?: string
          contact_type?: string
          created_at?: string | null
          description?: string
          id?: string
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_activities_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      contact_notes: {
        Row: {
          author_id: string | null
          contact_id: string
          contact_type: string
          content: string
          created_at: string | null
          id: string
          updated_at: string | null
        }
        Insert: {
          author_id?: string | null
          contact_id: string
          contact_type: string
          content: string
          created_at?: string | null
          id?: string
          updated_at?: string | null
        }
        Update: {
          author_id?: string | null
          contact_id?: string
          contact_type?: string
          content?: string
          created_at?: string | null
          id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      dispositions: {
        Row: {
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
      profiles: {
        Row: {
          availability_status: string
          avatar_url: string | null
          created_at: string
          email: string
          first_name: string
          id: string
          last_name: string
          phone: string | null
          role: string
          status: string
          theme_preference: string
          updated_at: string
        }
        Insert: {
          availability_status?: string
          avatar_url?: string | null
          created_at?: string
          email?: string
          first_name?: string
          id: string
          last_name?: string
          phone?: string | null
          role?: string
          status?: string
          theme_preference?: string
          updated_at?: string
        }
        Update: {
          availability_status?: string
          avatar_url?: string | null
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          phone?: string | null
          role?: string
          status?: string
          theme_preference?: string
          updated_at?: string
        }
        Relationships: []
      }
      recruits: {
        Row: {
          assigned_agent_id: string | null
          created_at: string | null
          email: string
          first_name: string
          id: string
          last_name: string
          notes: string | null
          phone: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          assigned_agent_id?: string | null
          created_at?: string | null
          email: string
          first_name: string
          id?: string
          last_name: string
          notes?: string | null
          phone?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          assigned_agent_id?: string | null
          created_at?: string | null
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          notes?: string | null
          phone?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recruits_assigned_agent_id_fkey"
            columns: ["assigned_agent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
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
      notifications: {
        Row: {
          id: string
          user_id: string
          type: string
          title: string
          body: string
          read: boolean
          action_url: string | null
          action_label: string | null
          metadata: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          type?: string
          title: string
          body: string
          read?: boolean
          action_url?: string | null
          action_label?: string | null
          metadata?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          type?: string
          title?: string
          body?: string
          read?: boolean
          action_url?: string | null
          action_label?: string | null
          metadata?: Json | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
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
