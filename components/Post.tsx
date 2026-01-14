
import React, { useState, useRef } from 'react';
import { Post as PostType } from '../types';
import { Trash2, GripHorizontal, ExternalLink, Clock, User, Quote, Pencil } from 'lucide-react';

interface PostProps {
  post: PostType;
  onDelete: (id: string) => void;
  onEdit?: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onMoveEnd?: (id: string, x: number, y: number) => void;
  isOwner: boolean;
  snapToGrid?: boolean;
  isWallAnonymous?: boolean;
  zoom: number;
}

const Post: React.FC<PostProps> = ({ post, onDelete, onEdit, onMove, onMoveEnd, isOwner, snapToGrid, isWallAnonymous, zoom }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const postStartPos = useRef({ x: 0, y: 0 });
  const currentPos = useRef({ x: post.x, y: post.y });

  const handleMouseDown = (e: React.MouseEvent) => {
    // STOP PROPAGATION to prevent the WallView canvas from panning when clicking a post
    e.stopPropagation();

    if (!isOwner) return;
    if ((e.target as HTMLElement).closest('button, video, a')) return;

    setIsDragging(true);
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    postStartPos.current = { x: post.x, y: post.y };
    currentPos.current = { x: post.x, y: post.y };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent) => {
    // Calculate delta taking zoom into account
    const dx = (e.clientX - dragStartPos.current.x) / zoom;
    const dy = (e.clientY - dragStartPos.current.y) / zoom;
    
    let nextX = postStartPos.current.x + dx;
    let nextY = postStartPos.current.y + dy;

    if (snapToGrid) {
      nextX = Math.round(nextX / 20) * 20;
      nextY = Math.round(nextY / 20) * 20;
    }

    currentPos.current = { x: nextX, y: nextY };
    onMove(post.id, nextX, nextY);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    if (onMoveEnd) {
      onMoveEnd(post.id, currentPos.current.x, currentPos.current.y);
    }
  };

  const renderContent = () => {
    switch (post.type) {
      case 'image':
        return <img src={post.content} alt="Post content" className="w-full h-auto rounded-lg mb-2 object-cover max-h-64 pointer-events-none" />;
      case 'gif':
        return <img src={post.content} alt="GIF" className="w-full h-auto rounded-lg mb-2 pointer-events-none" />;
      case 'link':
        return (
          <a href={post.metadata?.url} target="_blank" rel="noopener noreferrer" className="block bg-white/60 rounded-xl overflow-hidden hover:bg-white/90 transition-all border border-black/5 group shadow-sm">
            {post.metadata?.image && (
              <img src={post.metadata.image} className="w-full h-32 object-cover border-b border-black/5" alt="Preview" />
            )}
            <div className="p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-black text-indigo-600 uppercase tracking-tighter">Web Link</span>
                <ExternalLink size={12} className="text-slate-400 group-hover:text-indigo-500" />
              </div>
              <p className="text-sm font-bold line-clamp-2 text-slate-900 leading-tight">{post.metadata?.title || post.content}</p>
              {post.metadata?.description && (
                <p className="text-[10px] text-slate-500 line-clamp-2 mt-1 leading-relaxed">{post.metadata.description}</p>
              )}
            </div>
          </a>
        );
      case 'video':
        // content holds the base64 string
        return (
          <div className="relative group rounded-lg overflow-hidden mb-2 bg-black aspect-video">
            <video src={post.content} controls className="w-full h-full" />
          </div>
        );
      case 'ai':
        return (
          <div className="relative p-3 bg-indigo-50 rounded-lg border-l-4 border-indigo-400 mb-2">
            <div className="text-[10px] font-bold text-indigo-400 mb-1 uppercase tracking-widest">AI Generated</div>
            <p className="text-sm text-slate-800 leading-relaxed italic">"{post.content}"</p>
          </div>
        );
      default:
        return <p className="text-slate-800 leading-relaxed whitespace-pre-wrap font-medium">{post.content}</p>;
    }
  };

  const displayName = isWallAnonymous ? 'Anonymous' : post.authorName;
  
  // Handle both legacy classes (bg-white) and new hex codes
  const isHexColor = post.color?.startsWith('#');
  const containerStyle: React.CSSProperties = {
    left: post.x,
    top: post.y,
    zIndex: isDragging ? 9999 : post.zIndex,
    backgroundColor: isHexColor ? post.color : undefined
  };
  
  const containerClass = `post-container absolute p-4 w-[300px] rounded-2xl shadow-lg border border-black/5 transition-all duration-75 ${!isHexColor ? post.color : ''} group select-none ${isDragging ? 'shadow-2xl z-[9999] scale-[1.02] cursor-grabbing' : isOwner ? 'cursor-grab' : 'cursor-default'} hover:shadow-2xl`;

  return (
    <div 
      className={containerClass}
      style={containerStyle}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onMouseDown={handleMouseDown}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-white/40 rounded-full">
            <User size={12} className="text-slate-600" />
          </div>
          <span className="text-xs font-bold text-slate-700 truncate max-w-[120px]">{displayName}</span>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {isOwner && onEdit && (
             <button 
              onClick={(e) => { e.stopPropagation(); onEdit(post.id); }}
              className="p-1.5 text-slate-400 hover:text-cyan-600 hover:bg-cyan-50 rounded-lg transition-colors"
            >
              <Pencil size={14} />
            </button>
          )}
          {isOwner && (
            <button 
              onClick={(e) => { e.stopPropagation(); onDelete(post.id); }}
              className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            >
              <Trash2 size={14} />
            </button>
          )}
          {isOwner && (
            <div className="p-1.5 text-slate-400">
              <GripHorizontal size={16} />
            </div>
          )}
        </div>
      </div>

      <div className="min-h-[40px]">
        {renderContent()}
        
        {/* Caption Section */}
        {post.metadata?.caption && (
          <div className="mt-3 pt-3 border-t border-black/5">
            <p className="text-sm text-slate-700 font-medium italic flex gap-2">
              <Quote size={12} className="text-indigo-400 flex-shrink-0 mt-0.5" />
              {post.metadata.caption}
            </p>
          </div>
        )}
      </div>

      <div className="mt-4 pt-3 border-t border-black/5 flex items-center justify-between">
        <div className="flex items-center gap-1 text-[10px] text-slate-500 font-bold uppercase tracking-wider">
          <Clock size={10} />
          {new Date(post.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
};

export default Post;
