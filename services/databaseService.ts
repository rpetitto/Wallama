
import { createClient } from '@supabase/supabase-js';
import { Wall, Post } from '../types';

const supabaseUrl = 'https://nqektdwcbhwlgvwpxuwc.supabase.co';
const supabaseKey = 'sb_publishable_jL7BE1EAKR8MYM5tnHKVrQ_jeewBbXN';

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Data Mappers with safety checks
 */
const mapWallFromDB = (dbWall: any): Wall => {
  if (!dbWall) return null as any;
  return {
    id: dbWall.id,
    name: dbWall.name || 'Untitled Wall',
    description: dbWall.description || '',
    joinCode: dbWall.join_code || '',
    teacherId: dbWall.teacher_id || '',
    background: dbWall.background || 'from-indigo-500 via-purple-500 to-pink-500',
    snapToGrid: dbWall.snap_to_grid ?? true,
    isAnonymous: dbWall.is_anonymous ?? false,
    privacyType: dbWall.privacy_type || 'link',
    icon: dbWall.icon || '📝',
    posts: (dbWall.posts || []).map(mapPostFromDB)
  };
};

const mapPostFromDB = (dbPost: any): Post => {
  if (!dbPost) return null as any;
  return {
    id: dbPost.id,
    type: dbPost.type || 'text',
    content: dbPost.content || '',
    authorName: dbPost.author_name || 'Anonymous',
    authorId: dbPost.author_id || '',
    createdAt: dbPost.created_at ? new Date(dbPost.created_at).getTime() : Date.now(),
    x: Number(dbPost.x) || 0,
    y: Number(dbPost.y) || 0,
    zIndex: Number(dbPost.z_index) || 1, 
    color: dbPost.color || 'bg-white',
    metadata: dbPost.metadata || {}
  };
};

export const databaseService = {
  async getTeacherWalls(teacherId: string): Promise<Wall[]> {
    try {
      const { data, error } = await supabase
        .from('walls')
        .select(`*, posts (*)`)
        .eq('teacher_id', teacherId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []).map(mapWallFromDB).filter(Boolean);
    } catch (err) {
      console.error("SQL getTeacherWalls error:", err);
      return [];
    }
  },

  async getStudentWalls(userId: string): Promise<Wall[]> {
    try {
      // 1. Get IDs of walls the student has joined
      const { data: memberData, error: memberError } = await supabase
        .from('wall_members')
        .select('wall_id, last_accessed_at')
        .eq('user_id', userId)
        .order('last_accessed_at', { ascending: false });

      if (memberError || !memberData || memberData.length === 0) return [];

      const wallIds = memberData.map(m => m.wall_id);

      // 2. Fetch the walls
      const { data: wallsData, error: wallsError } = await supabase
        .from('walls')
        .select(`*, posts (*)`)
        .in('id', wallIds);

      if (wallsError) throw wallsError;
      return (wallsData || []).map(mapWallFromDB).filter(Boolean);
    } catch (err) {
      console.error("SQL getStudentWalls error:", err);
      return [];
    }
  },

  async joinWall(wallId: string, userId: string, role: string = 'student'): Promise<void> {
    try {
      // Upsert into wall_members to track that this user joined this wall
      // The 'last_accessed_at' helps sort them recently
      await supabase
        .from('wall_members')
        .upsert({ 
          wall_id: wallId, 
          user_id: userId, 
          role: role,
          last_accessed_at: new Date().toISOString()
        }, { onConflict: 'wall_id, user_id' });
    } catch (err) {
      console.error("Failed to track wall join:", err);
    }
  },

  async getWallById(id: string): Promise<Wall | null> {
    try {
      const { data, error } = await supabase
        .from('walls')
        .select(`*, posts (*)`)
        .eq('id', id)
        .single();

      if (error) return null;
      return mapWallFromDB(data);
    } catch (err) {
      console.error("SQL getWallById error:", err);
      return null;
    }
  },

  async getWallByCode(code: string): Promise<Wall | null> {
    try {
      const cleanCode = code.toUpperCase().trim();
      const { data, error } = await supabase
        .from('walls')
        .select(`*, posts (*)`)
        .eq('join_code', cleanCode)
        .maybeSingle();

      if (error || !data) return null;
      return mapWallFromDB(data);
    } catch (err) {
      return null;
    }
  },

  async createWall(wall: Partial<Wall>): Promise<Wall | null> {
    try {
      const { data, error } = await supabase
        .from('walls')
        .insert([{
          name: wall.name,
          description: wall.description,
          join_code: wall.joinCode,
          teacher_id: wall.teacherId,
          background: wall.background,
          snap_to_grid: wall.snapToGrid,
          is_anonymous: wall.isAnonymous,
          privacy_type: wall.privacyType,
          icon: wall.icon || '📝'
        }])
        .select().single();

      if (error) throw error;
      return mapWallFromDB({ ...data, posts: [] });
    } catch (err) {
      console.error("SQL createWall error:", err);
      return null;
    }
  },

  async addPost(wallId: string, post: Partial<Post>): Promise<Post | null> {
    try {
      let nextZ = 1;
      try {
        const { data: maxZData, error: zError } = await supabase
          .from('posts')
          .select('z_index')
          .eq('wall_id', wallId)
          .order('z_index', { ascending: false })
          .limit(1);
        
        if (!zError && maxZData && maxZData.length > 0) {
          nextZ = maxZData[0].z_index + 1;
        }
      } catch (e) {
        // Ignore z-index read errors
      }

      const fullPayload = {
        wall_id: wallId,
        type: post.type || 'text',
        content: post.content || '',
        author_name: post.authorName || 'Anonymous',
        author_id: post.authorId || 'anon',
        x: Math.round(post.x || 100),
        y: Math.round(post.y || 100),
        z_index: Math.round(nextZ),
        color: post.color || 'bg-white',
        metadata: post.metadata || {}
      };

      const { data, error } = await supabase
        .from('posts')
        .insert([fullPayload])
        .select().single();

      if (error) throw error;
      return mapPostFromDB(data);

    } catch (err) {
      console.error("SQL addPost failed:", err);
      return null;
    }
  },

  async updatePostContent(postId: string, post: Partial<Post>): Promise<Post | null> {
    try {
      const updates: any = {};
      if (post.content !== undefined) updates.content = post.content;
      if (post.type !== undefined) updates.type = post.type;
      if (post.color !== undefined) updates.color = post.color;
      if (post.metadata !== undefined) updates.metadata = post.metadata;

      const { data, error } = await supabase
        .from('posts')
        .update(updates)
        .eq('id', postId)
        .select()
        .single();

      if (error) throw error;
      return mapPostFromDB(data);
    } catch (err) {
      console.error("SQL updatePostContent failed:", err);
      return null;
    }
  },

  async updateWall(wallId: string, updates: Partial<Wall>): Promise<boolean> {
    try {
      const sqlUpdates: any = {};
      if (updates.name !== undefined) sqlUpdates.name = updates.name;
      if (updates.description !== undefined) sqlUpdates.description = updates.description;
      if (updates.background !== undefined) sqlUpdates.background = updates.background;
      if (updates.isAnonymous !== undefined) sqlUpdates.is_anonymous = updates.isAnonymous;
      if (updates.snapToGrid !== undefined) sqlUpdates.snap_to_grid = updates.snapToGrid;
      if (updates.privacyType !== undefined) sqlUpdates.privacy_type = updates.privacyType;
      if (updates.icon !== undefined) sqlUpdates.icon = updates.icon;

      const { error } = await supabase.from('walls').update(sqlUpdates).eq('id', wallId);
      return !error;
    } catch (err) {
      return false;
    }
  },

  async deletePost(postId: string): Promise<boolean> {
    const { error } = await supabase.from('posts').delete().eq('id', postId);
    return !error;
  },

  async updatePostPosition(postId: string, x: number, y: number, wallId: string): Promise<boolean> {
    try {
      const { data: maxZData } = await supabase
        .from('posts')
        .select('z_index')
        .eq('wall_id', wallId)
        .order('z_index', { ascending: false })
        .limit(1);
      
      const nextZ = (maxZData && maxZData.length > 0 ? maxZData[0].z_index : 0) + 1;

      const { error } = await supabase
        .from('posts')
        .update({ 
          x: Math.round(x), 
          y: Math.round(y), 
          z_index: Math.round(nextZ) 
        })
        .eq('id', postId);
        
      return !error;
    } catch (err) {
      return false;
    }
  }
};
