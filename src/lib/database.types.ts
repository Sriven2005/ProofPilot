export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      user_profiles: {
        Row: { user_id: string; display_name: string; created_at: string; updated_at: string };
        Insert: { user_id: string; display_name?: string; created_at?: string; updated_at?: string };
        Update: { display_name?: string; updated_at?: string };
        Relationships: [];
      };
      assessment_attempts: {
        Row: { id: string; user_id: string; report_reference: string; challenge_id: string; role_id: string; assessment_mode: 'assessment' | 'practice' | 'proof'; candidate_name: string; submitted_answer: string; challenge_snapshot: Json; evaluation_snapshot: Json; overall_score: number; score_trust: 'client_unverified' | 'server_verified'; completed_at: string; evaluator_version: string; legacy_source_id: string | null; created_at: string };
        Insert: { id?: string; user_id: string; report_reference: string; challenge_id: string; role_id: string; assessment_mode?: 'assessment' | 'practice' | 'proof'; candidate_name?: string; submitted_answer: string; challenge_snapshot: Json; evaluation_snapshot: Json; overall_score: number; score_trust?: 'client_unverified'; completed_at: string; evaluator_version?: string; legacy_source_id?: string | null; created_at?: string };
        Update: Record<string, never>;
        Relationships: [];
      };
      assessment_skill_results: {
        Row: { id: string; user_id: string; attempt_id: string; criterion_name: string; score: number; weight: number; evidence: Json; missing: Json; incorrect: Json; explanation: string; created_at: string };
        Insert: { id?: string; user_id: string; attempt_id: string; criterion_name: string; score: number; weight: number; evidence?: Json; missing?: Json; incorrect?: Json; explanation?: string; created_at?: string };
        Update: Record<string, never>;
        Relationships: [];
      };
      practice_history: {
        Row: { id: string; user_id: string; attempt_id: string; event_type: string; event_data: Json; occurred_at: string };
        Insert: { id?: string; user_id: string; attempt_id: string; event_type: string; event_data?: Json; occurred_at?: string };
        Update: Record<string, never>;
        Relationships: [];
      };
      proof_results: {
        Row: { attempt_id: string; user_id: string; verification_status: 'verified' | 'unverified'; verified_score: number | null; verified_at: string | null; evidence_snapshot: Json };
        Insert: { attempt_id: string; user_id: string; verification_status: 'unverified'; verified_score?: null; verified_at?: null; evidence_snapshot?: Json };
        Update: Record<string, never>;
        Relationships: [];
      };
      evidence_reports: {
        Row: { id: string; user_id: string; attempt_id: string; report_reference: string; visibility: 'private'; created_at: string };
        Insert: { id?: string; user_id: string; attempt_id: string; report_reference: string; visibility?: 'private'; created_at?: string };
        Update: Record<string, never>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      save_assessment_attempt: { Args: { p_attempt: Json; p_legacy_source_id?: string | null }; Returns: string };
      save_assessment_attempt_v2: { Args: { p_attempt: Json; p_legacy_source_id?: string | null }; Returns: string };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}
