export type ResourceType = 'video' | 'script' | 'document';

export interface TrainingResource {
  id: string;
  title: string;
  description: string;
  type: ResourceType;
  category: string;
  thumbnailUrl?: string;
  contentUrl?: string; // Link to video or doc
  content?: string; // For scripts
  duration?: string; // e.g. "5:30"
  fileSize?: string; // e.g. "2.4 MB"
  isCompleted?: boolean;
  createdAt: string;
}

export interface TrainingCategory {
  id: string;
  name: string;
  icon?: string;
}
