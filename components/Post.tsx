
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
  isKanbanColumn?: boolean;
  isKanbanCard?: boolean;
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
  isOwner, snapToGrid, isWallAnonymous, isWallFrozen, isTimelineMilestone, isKanbanColumn, isKanbanCard, zoom 
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [dragDelta, setDragDelta] = useState({ x: 0, y: 0 }); // Local visual delta for smooth dragging
  const [relativeTime, setRelativeTime] = useState(getRelativeTime(post.createdAt));
  
  const dragStartPos = useRef({ x: 0, y: 0 });
  const postStartPos = useRef({ x: post.x, y: post.y });
  const currentPos = useRef({ x: post.x, y: post.y });
  const containerRef = useRef<HTMLDivElement>(null);
  const lastOnMoveCall = useRef<number>(0); // For throttling parent updates

  const canDrag = isOwner && !isWallFrozen && (post.x !== 0 || post.y !== 0 || isTimelineMilestone || isKanbanColumn || isKanbanCard);

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

    let startX = post.x;
    let startY = post.y;

    // For Kanban cards, capture offset relative to column to simulate natural drag start
    if (isKanbanCard && containerRef.current) {
        startX = 0; 
        startY = containerRef.current.offsetTop;
    }

    setIsDragging(true);
    setDragDelta({ x: 0, y: 0 });
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    postStartPos.current = { x: startX, y: startY };
    currentPos.current = { x: startX, y: startY };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent) => {
    requestAnimationFrame(() => {
        const dx = (e.clientX - dragStartPos.current.x) / zoom;
        const dy = (e.clientY - dragStartPos.current.y) / zoom;
        
        // 1. Update Visuals Immediately (60fps)
        setDragDelta({ x: dx, y: dy });

        // 2. Calculate logical position for data model
        let nextX = postStartPos.current.x + dx;
        let nextY = isTimelineMilestone ? postStartPos.current.y : postStartPos.current.y + dy;
        
        if (snapToGrid) {
          nextX = Math.round(nextX / 20) * 20;
          if (!isTimelineMilestone && !isKanbanColumn && !isKanbanCard) nextY = Math.round(nextY / 20) * 20;
        }

        currentPos.current = { x: nextX, y: nextY };

        // 3. Throttle updates to parent to prevent layout thrashing (e.g., every 50ms)
        const now = Date.now();
        if (now - lastOnMoveCall.current > 50) {
            onMove(post.id, nextX, nextY);
            lastOnMoveCall.current = now;
        }
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setDragDelta({ x: 0, y: 0 });
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    
    // Ensure final position is synced
    if (onMoveEnd) {
      onMoveEnd(post.id, currentPos.current.x, currentPos.current.y);
    }
  };

  const renderContent = () => {
    if (isKanbanColumn) {
        return (
            <div className="text-center">
                <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest leading-none">{post.title || post.content}</h3>
            </div>
        );
    }

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
  const isWrapperControlled = isTimelineMilestone || isKanbanColumn || isKanbanCard;
  
  // When dragging, we force absolute positioning based on the *initial* start position + local delta.
  // This bypasses the React prop cycle for smooth 60fps movement.
  const isAbsolute = (isTimelineMilestone || isKanbanColumn) || (!isWrapperControlled && (post.x !== 0 || post.y !== 0)) || (isKanbanCard && isDragging);

  const containerStyle: React.CSSProperties = {
    // If dragging, we anchor to the start position and use transform for movement.
    // If not dragging, we use the prop position.
    left: isDragging ? postStartPos.current.x : ((isAbsolute && !isWrapperControlled) ? post.x : undefined),
    top: isDragging ? postStartPos.current.y : ((isAbsolute && !isWrapperControlled) ? post.y : undefined),
    
    // Add delta to transform. Include tilt and scale for feedback.
    transform: isDragging ? `translate(${dragDelta.x}px, ${dragDelta.y}px) rotate(2deg) scale(1.05)` : undefined,
    zIndex: isDragging ? 99999 : post.zIndex,
    
    backgroundColor: isHexColor ? post.color : undefined,
    position: (isAbsolute && (!isWrapperControlled || (isKanbanCard && isDragging))) ? 'absolute' : 'relative',
    width: (isAbsolute || isWrapperControlled) ? '300px' : '100%',
    
    // Disable transition during drag for instant response
    transition: isDragging ? 'none' : 'all 0.2s cubic-bezier(0.2, 0, 0, 1)' 
  };

  // Adjust padding for Kanban columns
  const paddingClass = isKanbanColumn ? 'py-2 px-3' : 'p-4';
  
  // Add shadow and cursor styles
  const shadowClass = isDragging ? 'shadow-2xl ring-4 ring-black/5' : 'shadow-lg hover:shadow-xl';
  const cursorClass = isDragging ? 'cursor-grabbing' : (canDrag ? 'cursor-grab' : 'cursor-default');
  
  const containerClass = `post-container ${paddingClass} rounded-2xl border border-black/5 ${!isHexColor ? post.color : ''} group select-none ${shadowClass} ${cursorClass}`;

  const PostContent = (
    <div ref={containerRef} className={containerClass} style={containerStyle} onMouseDown={handleMouseDown}>
      {!isKanbanColumn && (
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
            {isOwner && !isWallFrozen && isAbsolute && !isTimelineMilestone && !isKanbanColumn && !isKanbanCard && (
                <div className="p-1.5 text-slate-400"><GripHorizontal size={16} /></div>
            )}
            </div>
        </div>
      )}

      {isKanbanColumn && (
          <div className="flex items-center justify-between">
              {renderContent()}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {isOwner && onEdit && !isWallFrozen && (
                    <button onClick={(e) => { e.stopPropagation(); onEdit(post.id); }} className="p-1 text-slate-500 hover:text-cyan-600 hover:bg-cyan-50 rounded-lg transition-colors"><Pencil size={12} /></button>
                )}
                {isOwner && !isWallFrozen && (
                    <button onClick={(e) => { e.stopPropagation(); onDelete(post.id); }} className="p-1 text-slate-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={12} /></button>
                )}
              </div>
          </div>
      )}

      {!isKanbanColumn && (
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
      )}

      {!isKanbanColumn && (
        <div className="mt-4 pt-3 border-t border-black/5 flex items-center justify-between">
          <div className="flex items-center gap-1 text-[10px] text-slate-600 font-black uppercase tracking-wider">
            <Clock size={10} /> {relativeTime}
          </div>
        </div>
      )}
    </div>
  );

  if (isTimelineMilestone) {
    return (
      <div 
        className="absolute pointer-events-none group" 
        style={{ left: post.x, top: post.y, width: 0, height: 0, zIndex: isDragging ? 9999 : post.zIndex }}
      >
        <div className="absolute top-[-10px] left-[-10px] w-5 h-5 bg-cyan-600 rounded-full border-4 border-white shadow-md z-20" />
        
        <div className="absolute bottom-[20px] left-[-150px] w-[300px] flex flex-col items-center justify-end">
           <div className="w-full pointer-events-auto pb-2">
              {PostContent}
           </div>
           <div className="h-6 w-1 bg-cyan-600/30 rounded-full" />
        </div>

        <div className="absolute top-[20px] left-[-150px] w-[300px] flex flex-col items-center justify-start">
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

  if (isKanbanColumn) {
     return (
        <div 
            className="absolute flex flex-col items-center pointer-events-none" 
            style={{ left: post.x, top: 0, width: '320px', height: '100%', zIndex: isDragging ? 9999 : 1 }}
        >
            <div className="w-full pointer-events-auto mb-4">
                {PostContent}
            </div>
            
            <div className="w-full flex-1 flex flex-col gap-3 pointer-events-auto px-1 pb-20">
                {children}
                {!isWallFrozen && onAddDetail && (
                    <button 
                        onClick={(e) => { e.stopPropagation(); onAddDetail(post.id); }}
                        className="w-full py-3 border-2 border-dashed border-slate-300 rounded-2xl text-slate-400 font-bold hover:bg-white/50 hover:border-cyan-400 hover:text-cyan-600 transition-colors flex items-center justify-center gap-2"
                    >
                        <Plus size={16} /> Add Card
                    </button>
                )}
            </div>
        </div>
     )
  }

  return PostContent;
};

export default Post;
