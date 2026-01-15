
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Post as PostType } from '../types';
import { Trash2, GripHorizontal, ExternalLink, Clock, User, Quote, Pencil, HardDrive, Lock, MessageCirclePlus, Sparkles, Plus } from 'lucide-react';
import { marked } from 'marked';

interface PostProps {
  post: PostType;
  onDelete: (id: string) => void;
  onEdit?: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onMoveEnd?: (id: string, x: number, y: number) => void;
  onAddDetail?: (parentId: string) => void; 
  children?: React.ReactNode; 
  isOwner: boolean;
  snapToGrid?: boolean;
  isWallAnonymous?: boolean;
  isWallFrozen?: boolean;
  isTimelineMilestone?: boolean;
  zoom: number;
}

const getRelativeTime = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);

  if (seconds < 60) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  if (weeks < 4) return `${weeks}w ago`;
  return new Date(timestamp).toLocaleDateString();
};

const Post: React.FC<PostProps> = ({ 
  post, onDelete, onEdit, onMove, onMoveEnd, onAddDetail, children, 
  isOwner, snapToGrid, isWallAnonymous, isWallFrozen, isTimelineMilestone, zoom 
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [relativeTime, setRelativeTime] = useState(getRelativeTime(post.createdAt));
  const dragStartPos = useRef({ x: 0, y: 0 });
  const postStartPos = useRef({ x: post.x, y: post.y });
  const currentPos = useRef({ x: post.x, y: post.y });

  const canDrag = isOwner && !isWallFrozen && (post.x !== 0 || post.y !== 0 || isTimelineMilestone);

  const renderedMarkdown = useMemo(() => {
    if (post.type !== 'title' && (post.type as string) !== 'text') return null;
    return { __html: marked.parse(post.content || '', { breaks: true, gfm: true }) };
  }, [post.content, post.type]);

  useEffect(() => {
    const timer = setInterval(() => {
      setRelativeTime(getRelativeTime(post.createdAt));
    }, 60000); 
    return () => clearInterval(timer);
  }, [post.createdAt]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canDrag) return;
    if ((e.target as HTMLElement).closest('button, video, a, input, [role="button"]')) return;

    setIsDragging(true);
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    postStartPos.current = { x: post.x, y: post.y };
    currentPos.current = { x: post.x, y: post.y };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent) => {
    const dx = (e.clientX - dragStartPos.current.x) / zoom;
    const dy = (e.clientY - dragStartPos.current.y) / zoom;
    
    let nextX = postStartPos.current.x + dx;
    let nextY = isTimelineMilestone ? postStartPos.current.y : postStartPos.current.y + dy;

    if (snapToGrid) {
      nextX = Math.round(nextX / 20) * 20;
      if (!isTimelineMilestone) nextY = Math.round(nextY / 20) * 20;
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
    const pType = (post.type as string);
    switch (pType) {
      case 'title':
      case 'text':
        return (
          <div className="space-y-2">
             {post.metadata?.image && (
                <div className={`w-full h-32 rounded-xl overflow-hidden mb-3 border border-black/5 ${post.metadata.image.includes('from-') ? 'bg-gradient-to-br ' + post.metadata.image : ''}`}>
                   { !post.metadata.image.includes('from-') && <img src={post.metadata.image} className="w-full h-full object-cover" alt="Header" /> }
                </div>
             )}
             {post.title && (
                <h3 className="text-xl font-black text-slate-900 leading-tight tracking-tight mb-2">{post.title}</h3>
             )}
             <div 
               className="markdown-content text-slate-700 font-medium" 
               dangerouslySetInnerHTML={renderedMarkdown as any} 
             />
          </div>
        );
      case 'image':
        const isGradient = post.content.includes('from-');
        return (
          <div className={`w-full rounded-xl overflow-hidden mb-2 border border-black/5 ${isGradient ? 'bg-gradient-to-br h-48 ' + post.content : ''}`}>
            {!isGradient && <img src={post.content} alt="Post content" className="w-full h-auto object-cover max-h-64 pointer-events-none" />}
            {post.metadata?.caption && <p className="p-3 text-xs font-bold text-slate-800 bg-white/40 italic">{post.metadata.caption}</p>}
          </div>
        );
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
            </div>
          </a>
        );
      case 'drive':
        return (
            <a href={post.metadata?.url} target="_blank" rel="noopener noreferrer" className="block bg-white/80 rounded-xl overflow-hidden hover:bg-white transition-all border border-black/5 group shadow-sm">
                <div className="p-4 flex items-start gap-3">
                    {post.metadata?.image ? (
                        <img src={post.metadata.image} className="w-12 h-12 rounded-lg object-cover bg-slate-100" alt="Preview" referrerPolicy="no-referrer" />
                    ) : (
                        <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center">
                            <HardDrive className="text-slate-400" size={24} />
                        </div>
                    )}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                            {post.metadata?.iconLink && <img src={post.metadata.iconLink} className="w-4 h-4" alt="" />}
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Drive</span>
                        </div>
                        <p className="text-sm font-bold text-slate-900 leading-tight truncate">{post.metadata?.title || "Drive File"}</p>
                    </div>
                </div>
            </a>
        );
      case 'video':
        return (
          <div className="relative group rounded-lg overflow-hidden mb-2 bg-black aspect-video">
            <video 
              src={post.content} 
              poster={post.metadata?.videoThumbnail}
              controls 
              className="w-full h-full" 
            />
          </div>
        );
      case 'ai':
        return (
          <div className="relative p-3 bg-indigo-50 rounded-lg border-l-4 border-indigo-400 mb-2">
            <div className="text-[10px] font-bold text-indigo-400 mb-1 uppercase tracking-widest flex items-center gap-1"><Sparkles size={10} /> AI Enhanced</div>
            <p className="text-sm text-slate-900 leading-relaxed italic">"{post.content}"</p>
          </div>
        );
      default:
        return <p className="text-slate-900 leading-relaxed whitespace-pre-wrap font-medium">{post.content}</p>;
    }
  };

  const displayName = isWallAnonymous ? 'Anonymous' : post.authorName;
  const isHexColor = post.color?.startsWith('#');
  const isWrapperControlled = isTimelineMilestone;
  const isAbsolute = (isTimelineMilestone) || (!isTimelineMilestone && (post.x !== 0 || post.y !== 0));

  const containerStyle: React.CSSProperties = {
    left: (isAbsolute && !isWrapperControlled) ? post.x : undefined,
    top: (isAbsolute && !isWrapperControlled) ? post.y : undefined,
    zIndex: isDragging ? 9999 : post.zIndex,
    backgroundColor: isHexColor ? post.color : undefined,
    position: (isAbsolute && !isWrapperControlled) ? 'absolute' : 'relative',
    width: (isAbsolute || isWrapperControlled) ? '300px' : '100%'
  };
  
  const containerClass = `post-container p-4 rounded-2xl shadow-lg border border-black/5 transition-all duration-75 ${!isHexColor ? post.color : ''} group select-none ${isDragging ? 'shadow-2xl z-[9999] scale-[1.02] cursor-grabbing' : (canDrag ? 'cursor-grab' : 'cursor-default')} hover:shadow-2xl`;

  const PostContent = (
    <div className={containerClass} style={containerStyle} onMouseDown={handleMouseDown}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-full overflow-hidden bg-white/40 border border-black/5 flex items-center justify-center">
            {post.authorAvatar && !isWallAnonymous ? (
              <img src={post.authorAvatar} className="h-full w-full object-cover" alt="" referrerPolicy="no-referrer" />
            ) : (
              <User size={12} className="text-slate-600" />
            )}
          </div>
          <span className="text-xs font-bold text-slate-800 truncate max-w-[120px]">{displayName}</span>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {isWallFrozen && <Lock size={14} className="text-slate-400 mr-2" />}
          {isOwner && onEdit && !isWallFrozen && (
            <button onClick={(e) => { e.stopPropagation(); onEdit(post.id); }} className="p-1.5 text-slate-500 hover:text-cyan-600 hover:bg-cyan-50 rounded-lg transition-colors">
              <Pencil size={14} />
            </button>
          )}
          {isOwner && !isWallFrozen && (
            <button onClick={(e) => { e.stopPropagation(); onDelete(post.id); }} className="p-1.5 text-slate-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
              <Trash2 size={14} />
            </button>
          )}
          {isOwner && !isWallFrozen && isAbsolute && !isTimelineMilestone && (
            <div className="p-1.5 text-slate-400"><GripHorizontal size={16} /></div>
          )}
        </div>
      </div>

      <div className="min-h-[40px]">
        {renderContent()}
        {(post.type !== 'title' && (post.type as string) !== 'text' && post.metadata?.caption) && (
          <div className="mt-3 pt-3 border-t border-black/5 bg-white/40 -mx-4 px-4 pb-1 rounded-b-xl shadow-inner">
            <p className="text-sm text-slate-900 font-bold italic flex gap-2">
              <Quote size={12} className="text-indigo-500 flex-shrink-0 mt-0.5" />
              {post.metadata.caption}
            </p>
          </div>
        )}
      </div>

      <div className="mt-4 pt-3 border-t border-black/5 flex items-center justify-between">
        <div className="flex items-center gap-1 text-[10px] text-slate-600 font-black uppercase tracking-wider">
          <Clock size={10} /> {relativeTime}
        </div>
      </div>
    </div>
  );

  if (isTimelineMilestone) {
    return (
      <div 
        className="absolute pointer-events-none group" 
        style={{ left: post.x, top: post.y, width: 0, height: 0, zIndex: isDragging ? 9999 : post.zIndex }}
      >
        {/* Anchor Dot - Centered on Y=0 relative to this container (which is at axis Y) */}
        <div className="absolute top-[-10px] left-[-10px] w-5 h-5 bg-cyan-600 rounded-full border-4 border-white shadow-md z-20" />
        
        {/* Top Section: Milestone Post (Above Axis) */}
        <div className="absolute bottom-[20px] left-[-150px] w-[300px] flex flex-col items-center justify-end">
           <div className="w-full pointer-events-auto pb-2">
              {PostContent}
           </div>
           {/* Connector Stem */}
           <div className="h-6 w-1 bg-cyan-600/30 rounded-full" />
        </div>

        {/* Bottom Section: Details (Below Axis) */}
        <div className="absolute top-[20px] left-[-150px] w-[300px] flex flex-col items-center justify-start">
            {/* Connector Stem */}
            {(children || onAddDetail) && <div className="h-6 w-1 bg-cyan-600/30 absolute -top-6 rounded-full" />}
            
            <div className="flex flex-col items-center gap-3 w-full pointer-events-auto">
               {children}
               
               {!isWallFrozen && onAddDetail && (
                 <button 
                    onClick={(e) => { e.stopPropagation(); onAddDetail(post.id); }}
                    className="mt-1 h-8 w-8 bg-indigo-50 text-indigo-600 rounded-full border border-indigo-200 shadow-sm flex items-center justify-center hover:bg-indigo-600 hover:text-white transition-all pointer-events-auto z-30"
                    title="Add Detail to Milestone"
                 >
                    <Plus size={16} />
                 </button>
               )}
            </div>
        </div>
      </div>
    );
  }

  return PostContent;
};

export default Post;
