
export type UserRole = 'teacher' | 'student';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar?: string;
  isGuest?: boolean;
}

export type PostType = 'text' | 'image' | 'link' | 'gif' | 'video' | 'ai' | 'drive';

export interface Post {
  id: string;
  type: PostType;
  content: string;
  authorName: string;
  authorId: string;
  createdAt: number;
  x: number;
  y: number;
  zIndex: number;
  color: string;
  metadata?: {
    url?: string;
    title?: string;
    description?: string;
    image?: string;
    caption?: string; // Added caption support
    videoBlob?: string; 
    mimeType?: string; // For drive files
    iconLink?: string; // For drive files
  };
}

export type PrivacyType = 'public' | 'private' | 'link' | 'domain';

export interface Wall {
  id: string;
  name: string;
  joinCode: string;
  teacherId: string;
  posts: Post[];
  description: string;
  background: string;
  snapToGrid?: boolean;
  isAnonymous?: boolean;
  privacyType: PrivacyType;
  whitelist?: string[];
  icon?: string;
}

export interface GiphyResult {
  id: string;
  url: string;
  title: string;
}

export interface ClassroomCourse {
  id: string;
  name: string;
  section?: string;
  alternateLink: string;
}
