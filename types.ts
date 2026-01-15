
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
  authorAvatar?: string;
  createdAt: number;
  x: number;
  y: number;
  zIndex: number;
  color: string;
  parentId?: string; // Reference to another post for attachments/replies
  metadata?: {
    url?: string;
    title?: string;
    description?: string;
    image?: string;
    caption?: string; 
    videoBlob?: string; 
    videoThumbnail?: string; 
    mimeType?: string; 
    iconLink?: string; 
  };
}

export type PrivacyType = 'public' | 'private' | 'link' | 'domain';
export type WallType = 'freeform' | 'wall' | 'stream' | 'timeline';

export interface Wall {
  id: string;
  name: string;
  type: WallType;
  joinCode: string;
  teacherId: string;
  posts: Post[];
  description: string;
  background: string;
  snapToGrid?: boolean;
  isAnonymous?: boolean;
  isFrozen?: boolean;
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
