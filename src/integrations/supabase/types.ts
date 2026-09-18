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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: string
          created_at: string
          detail: string | null
          feature_id: string | null
          id: string
          project_id: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          detail?: string | null
          feature_id?: string | null
          id?: string
          project_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          detail?: string | null
          feature_id?: string | null
          id?: string
          project_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      area_assignments: {
        Row: {
          assigned_by: string | null
          created_at: string
          id: string
          user_id: string
          work_area_id: string
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string
          id?: string
          user_id: string
          work_area_id: string
        }
        Update: {
          assigned_by?: string | null
          created_at?: string
          id?: string
          user_id?: string
          work_area_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "area_assignments_work_area_id_fkey"
            columns: ["work_area_id"]
            isOneToOne: false
            referencedRelation: "work_areas"
            referencedColumns: ["id"]
          },
        ]
      }
      category_fields: {
        Row: {
          category_id: string
          field_type: Database["public"]["Enums"]["field_type"]
          id: string
          key: string
          label: string
          options: string[]
          required: boolean
          sort_order: number
        }
        Insert: {
          category_id: string
          field_type?: Database["public"]["Enums"]["field_type"]
          id?: string
          key: string
          label: string
          options?: string[]
          required?: boolean
          sort_order?: number
        }
        Update: {
          category_id?: string
          field_type?: Database["public"]["Enums"]["field_type"]
          id?: string
          key?: string
          label?: string
          options?: string[]
          required?: boolean
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "category_fields_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "feature_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_categories: {
        Row: {
          allow_overlap: boolean
          check_duplicates: boolean
          color: string
          created_at: string
          description: string | null
          geometry_type: Database["public"]["Enums"]["geom_type"]
          id: string
          name: string
          overlap_severity: string
          project_id: string | null
          require_within_area: boolean
          sort_order: number
        }
        Insert: {
          allow_overlap?: boolean
          check_duplicates?: boolean
          color?: string
          created_at?: string
          description?: string | null
          geometry_type: Database["public"]["Enums"]["geom_type"]
          id?: string
          name: string
          overlap_severity?: string
          project_id?: string | null
          require_within_area?: boolean
          sort_order?: number
        }
        Update: {
          allow_overlap?: boolean
          check_duplicates?: boolean
          color?: string
          created_at?: string
          description?: string | null
          geometry_type?: Database["public"]["Enums"]["geom_type"]
          id?: string
          name?: string
          overlap_severity?: string
          project_id?: string | null
          require_within_area?: boolean
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "feature_categories_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_comments: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          feature_id: string
          id: string
          project_id: string
          resolved: boolean
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          feature_id: string
          id?: string
          project_id: string
          resolved?: boolean
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          feature_id?: string
          id?: string
          project_id?: string
          resolved?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "feature_comments_feature_id_fkey"
            columns: ["feature_id"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feature_comments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      features: {
        Row: {
          area_sqm: number
          attributes: Json
          category_id: string | null
          created_at: string
          created_by: string | null
          dataset_id: string | null
          geometry: Json
          id: string
          length_m: number
          project_id: string | null
          review_note: string | null
          status: Database["public"]["Enums"]["review_status"]
          updated_at: string
          work_area_id: string | null
        }
        Insert: {
          area_sqm?: number
          attributes?: Json
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          dataset_id?: string | null
          geometry: Json
          id?: string
          length_m?: number
          project_id?: string | null
          review_note?: string | null
          status?: Database["public"]["Enums"]["review_status"]
          updated_at?: string
          work_area_id?: string | null
        }
        Update: {
          area_sqm?: number
          attributes?: Json
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          dataset_id?: string | null
          geometry?: Json
          id?: string
          length_m?: number
          project_id?: string | null
          review_note?: string | null
          status?: Database["public"]["Enums"]["review_status"]
          updated_at?: string
          work_area_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "features_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "feature_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "features_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "imagery_datasets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "features_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "features_work_area_id_fkey"
            columns: ["work_area_id"]
            isOneToOne: false
            referencedRelation: "work_areas"
            referencedColumns: ["id"]
          },
        ]
      }
      imagery_datasets: {
        Row: {
          bounds: Json | null
          center_lat: number | null
          center_lng: number | null
          created_at: string
          created_by: string | null
          description: string | null
          flight_date: string | null
          gsd_cm: number | null
          id: string
          is_published: boolean
          max_zoom: number
          min_zoom: number
          name: string
          project_id: string | null
          tile_type: string
          url: string
        }
        Insert: {
          bounds?: Json | null
          center_lat?: number | null
          center_lng?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          flight_date?: string | null
          gsd_cm?: number | null
          id?: string
          is_published?: boolean
          max_zoom?: number
          min_zoom?: number
          name: string
          project_id?: string | null
          tile_type?: string
          url: string
        }
        Update: {
          bounds?: Json | null
          center_lat?: number | null
          center_lng?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          flight_date?: string | null
          gsd_cm?: number | null
          id?: string
          is_published?: boolean
          max_zoom?: number
          min_zoom?: number
          name?: string
          project_id?: string | null
          tile_type?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "imagery_datasets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          username: string | null
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          username?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          username?: string | null
        }
        Relationships: []
      }
      project_members: {
        Row: {
          added_by: string | null
          created_at: string
          id: string
          project_id: string
          role: Database["public"]["Enums"]["project_role"]
          user_id: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          id?: string
          project_id: string
          role?: Database["public"]["Enums"]["project_role"]
          user_id: string
        }
        Update: {
          added_by?: string | null
          created_at?: string
          id?: string
          project_id?: string
          role?: Database["public"]["Enums"]["project_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          boundary: Json | null
          client_ref: string | null
          created_at: string
          created_by: string | null
          crs: string
          description: string | null
          due_date: string | null
          id: string
          name: string
          start_date: string | null
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
        }
        Insert: {
          boundary?: Json | null
          client_ref?: string | null
          created_at?: string
          created_by?: string | null
          crs?: string
          description?: string | null
          due_date?: string | null
          id?: string
          name: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Update: {
          boundary?: Json | null
          client_ref?: string | null
          created_at?: string
          created_by?: string | null
          crs?: string
          description?: string | null
          due_date?: string | null
          id?: string
          name?: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      work_areas: {
        Row: {
          boundary: Json
          created_at: string
          created_by: string | null
          id: string
          name: string
          notes: string | null
          project_id: string
          status: Database["public"]["Enums"]["area_status"]
        }
        Insert: {
          boundary: Json
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          notes?: string | null
          project_id: string
          status?: Database["public"]["Enums"]["area_status"]
        }
        Update: {
          boundary?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          notes?: string | null
          project_id?: string
          status?: Database["public"]["Enums"]["area_status"]
        }
        Relationships: [
          {
            foreignKeyName: "work_areas_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_digitize_in: {
        Args: { _project_id: string; _user_id: string; _work_area_id: string }
        Returns: boolean
      }
      can_manage_project: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      can_review_project: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_app_admin: { Args: { _user_id: string }; Returns: boolean }
      is_assigned_to_area: {
        Args: { _user_id: string; _work_area_id: string }
        Returns: boolean
      }
      is_project_member: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      project_role_of: {
        Args: { _project_id: string; _user_id: string }
        Returns: Database["public"]["Enums"]["project_role"]
      }
    }
    Enums: {
      app_role: "admin" | "contributor"
      area_status:
        | "unassigned"
        | "assigned"
        | "in_progress"
        | "submitted"
        | "complete"
      field_type: "text" | "number" | "boolean" | "select"
      geom_type: "polygon" | "line" | "point"
      project_role: "manager" | "supervisor" | "contributor"
      project_status:
        | "setup"
        | "active"
        | "review"
        | "closed"
        | "draft"
        | "on_hold"
        | "completed"
        | "archived"
      review_status:
        | "draft"
        | "submitted"
        | "verified"
        | "needs_revision"
        | "under_review"
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
    Enums: {
      app_role: ["admin", "contributor"],
      area_status: [
        "unassigned",
        "assigned",
        "in_progress",
        "submitted",
        "complete",
      ],
      field_type: ["text", "number", "boolean", "select"],
      geom_type: ["polygon", "line", "point"],
      project_role: ["manager", "supervisor", "contributor"],
      project_status: [
        "setup",
        "active",
        "review",
        "closed",
        "draft",
        "on_hold",
        "completed",
        "archived",
      ],
      review_status: [
        "draft",
        "submitted",
        "verified",
        "needs_revision",
        "under_review",
      ],
    },
  },
} as const
