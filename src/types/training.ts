export type ResourceType = 'video' | 'script' | 'document';

export interface TrainingResource {
  id: string;
  organization_id: string;
  category_id?: string;
  category_name?: string; // Virtual field for UI
  title: string;
  description?: string;
  type: ResourceType;
  content_url?: string;
  content?: string;
  thumbnail_url?: string;
  duration?: string;
  file_size?: string;
  is_completed?: boolean; // Joined from progress table
  created_at: string;
}

export interface TrainingCategory {
  id: string;
  organization_id: string;
  name: string;
  created_at: string;
}
