
export type UserRole = 'teacher' | 'student';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar?: string;
  isGuest?: boolean;
}

export type PostType = 'title' | 'text' | 'image' | 'link' | 'gif' | 'video' | 'ai' | 'drive';

export interface Post {
  id: string;
  type: PostType;
  title?: string; // Mapped to new SQL column
  content: string; // Mapped to Body
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
    /** A path under /api/media — it used to be a base64 data URL in this field. */
    videoBlob?: string;
    videoThumbnail?: string; 
    mimeType?: string; 
    iconLink?: string; 
  };
}

export type PrivacyType = 'public' | 'private' | 'link' | 'domain';
export type WallType = 'freeform' | 'wall' | 'stream' | 'timeline' | 'kanban';

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
  requireLoginToPost?: boolean;
  /**
   * How many posts the wall has, without the posts themselves. The dashboard
   * only prints a count, and fetching every post of every wall to render a
   * number was most of what made signing in slow.
   */
  postCount?: number;
  /**
   * Bumped by the server on every change to the wall or anything on it. It is
   * what the polling ETag is built from — see databaseService.getWall.
   */
  rev?: number;
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
