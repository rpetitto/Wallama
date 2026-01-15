
import React, { useState, useRef, useEffect } from 'react';
import { PostType, Post } from '../types';
import { X, Image as ImageIcon, Link as LinkIcon, Gift, Video, Sparkles, Send, Camera, StopCircle, Upload, Loader2, Type, Search, Check, Palette, MessageSquare, ShieldAlert, Save, HardDrive, Bold, Italic, Underline, Code, List, ListOrdered, Scissors } from 'lucide-react';
import { refinePostContent, checkContentSafety } from '../services/geminiService';
import { WALL_COLORS } from '../constants';

// Declare global google for OAuth
declare const google: any;

interface PostEditorProps {
  onClose: () => void;
  onSubmit: (post: Partial<Post>) => void;
  authorName: string;
  initialPost?: Post;
  parentId?: string; // Support for attached details
}

const GIPHY_API_KEY = 'eo5zSu2rUveZJB4kxO3S1Rv57KkMbhiQ'; 
const GOOGLE_CLIENT_ID = "6888240288-5v0p6nsoi64q1puv1vpvk1njd398ra8b.apps.googleusercontent.com";

const PostEditor: React.FC<PostEditorProps> = ({ onClose, onSubmit, authorName, initialPost, parentId }) => {
  const [type, setType] = useState<PostType>('text');
  const [content, setContent] = useState('');
  const [caption, setCaption] = useState('');
  const [url, setUrl] = useState('');
  const [selectedColor, setSelectedColor] = useState(WALL_COLORS[0]);
  const [isRecording, setIsRecording] = useState(false);
  const [videoBase64, setVideoBase64] = useState<string | null>(null);
  const [videoThumbnail, setVideoThumbnail] = useState<string | null>(null);
  const [thumbnailTime, setThumbnailTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [isRefining, setIsRefining] = useState(false);
  const [isFetchingLink, setIsFetchingLink] = useState(false);
  const [linkMetadata, setLinkMetadata] = useState<any>(null);
  const [isCheckingSafety, setIsCheckingSafety] = useState(false);
  const [safetyError, setSafetyError] = useState<string | null>(null);
  
  // Giphy State
  const [gifSearch, setGifSearch] = useState('');
  const [gifs, setGifs] = useState<any[]>([]);
  const [isSearchingGifs, setIsSearchingGifs] = useState(false);

  // Drive State
  const [driveFiles, setDriveFiles] = useState<any[]>([]);
  const [isDriveLoading, setIsDriveLoading] = useState(false);
  const [driveToken, setDriveToken] = useState<string | null>(null);
  const [driveSearch, setDriveSearch] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const driveTokenClient = useRef<any>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Initialize state if editing
  useEffect(() => {
    if (initialPost) {
      setType(initialPost.type);
      setSelectedColor(initialPost.color || WALL_COLORS[0]);
      
      if (initialPost.metadata?.caption) {
        setCaption(initialPost.metadata.caption);
      }

      if (initialPost.type === 'text') {
        setContent(initialPost.content);
      } else if (initialPost.type === 'video') {
         setVideoBase64(initialPost.content);
         if (initialPost.metadata?.videoThumbnail) {
           setVideoThumbnail(initialPost.metadata.videoThumbnail);
         }
      } else if (initialPost.type === 'link') {
         setUrl(initialPost.content);
         setLinkMetadata(initialPost.metadata);
      } else if (initialPost.type === 'drive') {
         setUrl(initialPost.content);
         setLinkMetadata(initialPost.metadata);
      } else {
         setUrl(initialPost.content);
      }
    }
  }, [initialPost]);

  // Init Google OAuth for Drive
  useEffect(() => {
    if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
      driveTokenClient.current = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        callback: (response: any) => {
          if (response.access_token) {
            setDriveToken(response.access_token);
            fetchDriveFiles(response.access_token);
          }
        },
      });
    }
  }, []);

  const handleDriveAuth = () => {
    if (driveTokenClient.current) {
        driveTokenClient.current.requestAccessToken();
    } else {
        alert("Google services not ready. Please wait a moment.");
    }
  };

  const fetchDriveFiles = async (token: string, query: string = '') => {
    setIsDriveLoading(true);
    try {
        let q = "trashed = false and mimeType != 'application/vnd.google-apps.folder'";
        if (query) {
            q += ` and name contains '${query}'`;
        }
        
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&pageSize=20&fields=files(id,name,thumbnailLink,webViewLink,mimeType,iconLink,webContentLink)`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        
        if (res.ok) {
            const data = await res.json();
            setDriveFiles(data.files || []);
        }
    } catch (e) {
        console.error(e);
    } finally {
        setIsDriveLoading(false);
    }
  };

  const searchGifs = async (query: string) => {
    setIsSearchingGifs(true);
    try {
      let endpoint = `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=25&offset=0&rating=g&lang=en&bundle=messaging_non_clips`;
      if (query === 'trending' || !query) {
        endpoint = `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=25&rating=g`;
      }
      
      const res = await fetch(endpoint);
      const data = await res.json();
      setGifs(data.data || []);
    } catch (err) {
      console.error("Giphy Fetch Error:", err);
    } finally {
      setIsSearchingGifs(false);
    }
  };

  useEffect(() => {
    if (type === 'gif' && gifs.length === 0) {
      searchGifs('trending');
    }
  }, [type]);

  const handleRefine = async () => {
    if (!content) return;
    setIsRefining(true);
    const refined = await refinePostContent(content, 'text');
    setContent(refined);
    setIsRefining(false);
  };

  const fetchLinkMetadata = async (targetUrl: string) => {
    if (!targetUrl || !targetUrl.startsWith('http')) return;
    setIsFetchingLink(true);
    try {
      const res = await fetch(`https://api.microlink.io?url=${encodeURIComponent(targetUrl)}`);
      const data = await res.json();
      if (data.status === 'success') {
        setLinkMetadata({
          title: data.data.title,
          description: data.data.description,
          image: data.data.image?.url || data.data.logo?.url,
          url: targetUrl
        });
      } else {
        setLinkMetadata({ title: targetUrl, url: targetUrl });
      }
    } catch (err) {
      setLinkMetadata({ title: targetUrl, url: targetUrl });
    } finally {
      setIsFetchingLink(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => { setUrl(reader.result as string); };
      reader.readAsDataURL(file);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (videoRef.current) videoRef.current.srcObject = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/mp4' });
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => { 
          setVideoBase64(reader.result as string);
          setVideoThumbnail(null); // Reset thumbnail on new record
        };
        stream.getTracks().forEach(t => t.stop());
      };
      recorder.start();
      setIsRecording(true);
    } catch (err) {
      alert("Microphone/Camera access required");
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  // Thumbnail Capture Logic
  const captureThumbnail = () => {
    const video = previewVideoRef.current;
    if (!video) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      setVideoThumbnail(dataUrl);
    }
  };

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setThumbnailTime(time);
    if (previewVideoRef.current) {
      previewVideoRef.current.currentTime = time;
    }
  };

  const applyMarkdown = (prefix: string, suffix: string = '') => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selected = text.substring(start, end);
    const before = text.substring(0, start);
    const after = text.substring(end);

    const newText = `${before}${prefix}${selected}${suffix}${after}`;
    setContent(newText);
    
    // Restore focus and selection
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, end + prefix.length);
    }, 0);
  };

  const handleSelectDriveFile = (file: any) => {
      setUrl(file.webViewLink);
      setLinkMetadata({
          title: file.name,
          mimeType: file.mimeType,
          image: file.thumbnailLink,
          iconLink: file.iconLink,
          url: file.webViewLink
      });
  };

  const handleSubmit = async () => {
    let submissionContent = content;
    let submissionMetadata: any = {};
    setSafetyError(null);

    if (type === 'video') {
      submissionContent = videoBase64 || '';
      submissionMetadata.videoThumbnail = videoThumbnail;
    }
    else if (type === 'image' || type === 'gif') submissionContent = url;
    else if (type === 'link') {
      submissionContent = url;
      submissionMetadata = { ...(linkMetadata || { url, title: url }) };
    }
    else if (type === 'drive') {
        submissionContent = url;
        submissionMetadata = linkMetadata;
    }

    if (!submissionContent && type !== 'text') return;
    if (type === 'text' && !content) return;

    if (caption) {
      submissionMetadata.caption = caption;
    }
    
    if (initialPost && initialPost.metadata) {
        submissionMetadata = { ...initialPost.metadata, ...submissionMetadata };
    }

    // --- SAFETY CHECK START ---
    setIsCheckingSafety(true);
    const textToCheckParts = [];
    if (type === 'text') textToCheckParts.push(content);
    if (caption) textToCheckParts.push(caption);
    if ((type === 'link' || type === 'drive') && linkMetadata) {
      if (linkMetadata.title) textToCheckParts.push(linkMetadata.title);
      if (linkMetadata.description) textToCheckParts.push(linkMetadata.description);
    }
    if (url) textToCheckParts.push(url);
    const textToAnalyze = textToCheckParts.join(' ');
    let imageToAnalyze = undefined;
    if (type === 'image' && url.startsWith('data:')) {
        imageToAnalyze = url;
    }
    if (textToAnalyze.length > 0 || imageToAnalyze) {
      const safetyResult = await checkContentSafety(textToAnalyze, imageToAnalyze);
      if (!safetyResult.isSafe) {
        setIsCheckingSafety(false);
        setSafetyError(safetyResult.reason || "Content flagged as inappropriate.");
        return; 
      }
    }
    setIsCheckingSafety(false);
    // --- SAFETY CHECK END ---
    
    onSubmit({
      type,
      content: submissionContent,
      metadata: submissionMetadata,
      color: selectedColor,
      parentId: parentId || undefined
    });
  };

  const isHexColor = selectedColor.startsWith('#');

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div 
        className={`w-full max-w-xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] transition-colors duration-300 ${!isHexColor && selectedColor === 'bg-white' ? 'bg-white' : (!isHexColor ? selectedColor : '')}`}
        style={{ backgroundColor: isHexColor ? selectedColor : undefined }}
      >
        <div className="p-6 border-b border-black/5 flex items-center justify-between bg-white/50 backdrop-blur-sm">
          <div>
            <h3 className="text-xl font-bold text-slate-800">{parentId ? 'Add Detail to Milestone' : (initialPost ? 'Edit Post' : 'Add to Wallama')}</h3>
            <p className="text-sm text-slate-600 font-medium">Author: {authorName}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-black/5 rounded-full transition-colors text-slate-500">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-6 custom-scrollbar">
          {/* Post Type Selector */}
          <div className="flex gap-2 p-1 bg-black/5 rounded-xl overflow-x-auto">
            {[
              { id: 'text', icon: Type, label: 'Text' },
              { id: 'image', icon: ImageIcon, label: 'Image' },
              { id: 'link', icon: LinkIcon, label: 'Link' },
              { id: 'drive', icon: HardDrive, label: 'Drive' },
              { id: 'gif', icon: Gift, label: 'GIF' },
              { id: 'video', icon: Video, label: 'Video' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => { 
                    setType(tab.id as PostType); 
                    if (tab.id !== 'text') setContent(''); 
                    if (tab.id !== 'drive') { 
                       setUrl(''); 
                       setLinkMetadata(null);
                    }
                    setSafetyError(null); 
                }}
                className={`flex-1 min-w-[60px] flex flex-col items-center gap-1 py-3 px-2 rounded-lg transition-all ${type === tab.id ? 'bg-white shadow-sm text-cyan-600' : 'text-slate-500 hover:bg-black/5'}`}
              >
                <tab.icon size={20} />
                <span className="text-[10px] font-bold uppercase tracking-widest">{tab.label}</span>
              </button>
            ))}
          </div>

          <div className="space-y-4">
            {type === 'text' && (
              <div className="space-y-2">
                {/* Markdown Toolbar */}
                <div className="flex gap-1 p-1 bg-white/30 rounded-lg border border-black/5">
                  <button onClick={() => applyMarkdown('**', '**')} className="p-2 hover:bg-white/50 rounded-md transition-colors" title="Bold"><Bold size={16} /></button>
                  <button onClick={() => applyMarkdown('*', '*')} className="p-2 hover:bg-white/50 rounded-md transition-colors" title="Italic"><Italic size={16} /></button>
                  <button onClick={() => applyMarkdown('<u>', '</u>')} className="p-2 hover:bg-white/50 rounded-md transition-colors" title="Underline"><Underline size={16} /></button>
                  <div className="w-px h-6 bg-black/10 mx-1 self-center" />
                  <button onClick={() => applyMarkdown('`', '`')} className="p-2 hover:bg-white/50 rounded-md transition-colors" title="Code"><Code size={16} /></button>
                  <button onClick={() => applyMarkdown('- ')} className="p-2 hover:bg-white/50 rounded-md transition-colors" title="Bullet List"><List size={16} /></button>
                  <button onClick={() => applyMarkdown('1. ')} className="p-2 hover:bg-white/50 rounded-md transition-colors" title="Numbered List"><ListOrdered size={16} /></button>
                </div>
                <div className="relative">
                  <textarea
                    ref={textareaRef}
                    value={content}
                    onChange={(e) => { setContent(e.target.value); setSafetyError(null); }}
                    placeholder="Type something amazing... Markdown supported!"
                    className="w-full h-40 p-4 bg-white/50 border border-black/5 rounded-2xl focus:ring-4 focus:ring-cyan-500/20 focus:border-cyan-500 outline-none resize-none text-lg text-slate-900 placeholder:text-slate-400"
                  />
                  <button
                    onClick={handleRefine}
                    disabled={!content || isRefining}
                    className="absolute bottom-4 right-4 flex items-center gap-2 px-3 py-1.5 bg-cyan-600 text-white rounded-full text-xs font-bold hover:bg-cyan-700 disabled:opacity-50 shadow-md transition-all"
                  >
                    <Sparkles size={14} /> {isRefining ? 'Refining...' : 'AI Refine'}
                  </button>
                </div>
              </div>
            )}

            {type === 'link' && (
              <div className="space-y-4">
                <div className="relative">
                  <input
                    type="text"
                    value={url}
                    onBlur={() => fetchLinkMetadata(url)}
                    onChange={(e) => { setUrl(e.target.value); setSafetyError(null); }}
                    placeholder="https://example.com"
                    className="w-full p-4 bg-white/50 border border-black/5 rounded-xl outline-none text-slate-900 placeholder:text-slate-400 focus:ring-4 focus:ring-cyan-500/20"
                  />
                  {isFetchingLink && <Loader2 className="absolute right-4 top-4 animate-spin text-cyan-500" size={20} />}
                </div>
                {linkMetadata && (
                  <div className="p-4 bg-white/60 rounded-2xl border border-black/5 flex gap-4">
                    {linkMetadata.image && <img src={linkMetadata.image} className="h-20 w-20 rounded-lg object-cover" alt="Thumb" />}
                    <div className="flex-1">
                      <p className="text-sm font-bold text-slate-900 line-clamp-1">{linkMetadata.title}</p>
                      {linkMetadata.description && <p className="text-xs text-slate-500 line-clamp-2 mt-1">{linkMetadata.description}</p>}
                    </div>
                  </div>
                )}
              </div>
            )}

            {type === 'drive' && (
                <div className="space-y-4">
                    {!driveToken ? (
                        <div className="text-center py-10 bg-white/50 rounded-2xl border border-black/5">
                            <HardDrive size={48} className="mx-auto text-slate-300 mb-4" />
                            <p className="text-slate-600 font-medium mb-4">Connect Google Drive to select files.</p>
                            <button onClick={handleDriveAuth} className="px-6 py-2 bg-slate-800 text-white rounded-full font-bold hover:bg-slate-900 transition-colors">
                                Connect Drive
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="relative">
                                <input 
                                  type="text" 
                                  placeholder="Search Drive..." 
                                  value={driveSearch}
                                  onChange={(e) => setDriveSearch(e.target.value)}
                                  onKeyDown={(e) => e.key === 'Enter' && fetchDriveFiles(driveToken, driveSearch)}
                                  className="w-full pl-10 pr-4 py-3 bg-white/50 border border-black/5 rounded-xl outline-none focus:ring-2 focus:ring-cyan-500/20"
                                />
                                <Search size={18} className="absolute left-3 top-3.5 text-slate-400" />
                                {isDriveLoading && <Loader2 size={18} className="absolute right-3 top-3.5 animate-spin text-cyan-500" />}
                            </div>
                            <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto custom-scrollbar p-1">
                                {driveFiles.map(file => (
                                    <div 
                                      key={file.id} 
                                      onClick={() => handleSelectDriveFile(file)}
                                      className={`p-3 bg-white rounded-xl border cursor-pointer transition-all flex items-center gap-3 ${url === file.webViewLink ? 'border-cyan-600 ring-2 ring-cyan-500/20' : 'border-black/5 hover:bg-white/80'}`}
                                    >
                                        {file.thumbnailLink ? (
                                            <img src={file.thumbnailLink} className="w-10 h-10 object-cover rounded-lg" alt="Thumb" referrerPolicy="no-referrer" />
                                        ) : (
                                            <img src={file.iconLink} className="w-8 h-8" alt="Icon" />
                                        )}
                                        <div className="overflow-hidden">
                                            <p className="text-xs font-bold text-slate-800 truncate">{file.name}</p>
                                            <p className="text-[10px] text-slate-500 truncate">Google Drive</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {type === 'gif' && (
              <div className="space-y-4">
                <div className="flex gap-2 w-full">
                  <div className="relative flex-1 min-w-0">
                    <input
                      type="text"
                      value={gifSearch}
                      onChange={(e) => setGifSearch(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && searchGifs(gifSearch)}
                      placeholder="Search Giphy..."
                      className="w-full pl-12 pr-4 py-4 bg-white/50 border border-black/5 rounded-xl outline-none focus:ring-4 focus:ring-cyan-500/20 text-slate-900 placeholder:text-slate-500"
                    />
                    <Search className="absolute left-4 top-4 text-slate-400" size={20} />
                    {isSearchingGifs && <Loader2 className="absolute right-4 top-4 animate-spin text-cyan-500" size={20} />}
                  </div>
                  <button onClick={() => searchGifs(gifSearch)} className="flex-shrink-0 px-6 bg-cyan-600 text-white rounded-xl font-bold">Search</button>
                </div>
                <div className="grid grid-cols-3 gap-2 max-h-72 overflow-y-auto p-1 custom-scrollbar">
                  {gifs.map(gif => (
                    <button
                      key={gif.id}
                      onClick={() => setUrl(gif.images.fixed_height.url)}
                      className={`relative aspect-square rounded-lg overflow-hidden border-4 transition-all ${url === gif.images.fixed_height.url ? 'border-cyan-600' : 'border-transparent'}`}
                    >
                      <img src={gif.images.fixed_height.url} className="w-full h-full object-cover" alt="" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {type === 'video' && (
              <div className="space-y-4">
                <div className="aspect-video bg-black rounded-2xl overflow-hidden relative shadow-inner">
                  <video ref={videoRef} autoPlay muted playsInline className={`w-full h-full object-cover ${!isRecording && !videoBase64 ? 'hidden' : ''}`} />
                  {videoBase64 && !isRecording && (
                    <video 
                      ref={previewVideoRef} 
                      src={videoBase64} 
                      onLoadedMetadata={(e) => setVideoDuration(e.currentTarget.duration)}
                      controls={false} 
                      className="w-full h-full object-cover absolute inset-0" 
                    />
                  )}
                </div>

                {videoBase64 && !isRecording && (
                  <div className="p-4 bg-white/50 rounded-2xl border border-black/5 space-y-3">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                       <Scissors size={14} /> Select Thumbnail Frame
                    </label>
                    <div className="flex items-center gap-3">
                      <input 
                        type="range" 
                        min="0" 
                        max={videoDuration || 100} 
                        step="0.1" 
                        value={thumbnailTime} 
                        onChange={handleScrub}
                        className="flex-1 accent-cyan-600"
                      />
                      <button 
                        onClick={captureThumbnail}
                        className="px-4 py-2 bg-slate-800 text-white rounded-lg text-xs font-bold hover:bg-slate-900 transition-all flex items-center gap-2"
                      >
                         Capture
                      </button>
                    </div>
                    {videoThumbnail && (
                      <div className="flex items-center gap-3 mt-2">
                        <img src={videoThumbnail} className="h-16 w-28 rounded-lg object-cover border border-black/10" alt="Thumb" />
                        <span className="text-[10px] font-bold text-green-600 uppercase tracking-widest flex items-center gap-1">
                          <Check size={12} /> Thumbnail Set
                        </span>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex justify-center gap-4">
                  {!isRecording ? (
                    <button onClick={startRecording} className="flex items-center gap-2 px-8 py-3 bg-red-600 text-white rounded-full hover:bg-red-700 font-bold">
                      <Camera size={20} /> {videoBase64 ? 'Record New' : 'Start Recording'}
                    </button>
                  ) : (
                    <button onClick={stopRecording} className="flex items-center gap-2 px-8 py-3 bg-slate-800 text-white rounded-full font-bold animate-pulse">
                      <StopCircle size={20} /> Stop
                    </button>
                  )}
                </div>
              </div>
            )}

            {type === 'image' && (
               <div className="space-y-4">
                <div onClick={() => fileInputRef.current?.click()} className="w-full h-48 border-2 border-dashed border-slate-300 rounded-2xl flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-white/50 bg-white/30 overflow-hidden">
                  {url ? <img src={url} className="w-full h-full object-contain" alt="Preview" /> : <><Upload size={40} /><p className="text-sm font-bold">Upload Image</p></>}
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                </div>
              </div>
            )}

            <div className="pt-2">
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                <MessageSquare size={14} /> Caption (Optional)
              </label>
              <input
                type="text"
                value={caption}
                onChange={(e) => { setCaption(e.target.value); setSafetyError(null); }}
                placeholder="Add a description..."
                className="w-full px-4 py-3 bg-white/50 border border-black/5 rounded-xl outline-none text-sm"
              />
            </div>

            <div className="pt-2">
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                <Palette size={14} /> Post Color
              </label>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {WALL_COLORS.map(color => (
                  <button
                    key={color}
                    onClick={() => setSelectedColor(color)}
                    style={{ backgroundColor: color }}
                    className={`h-10 w-10 rounded-full border-2 transition-all ${selectedColor === color ? 'border-cyan-600 scale-110 shadow-md' : 'border-black/10 hover:scale-105'}`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
        
        {safetyError && (
          <div className="mx-6 mb-2 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3">
             <ShieldAlert className="text-red-500" size={20} />
             <p className="text-sm text-red-700 font-medium leading-tight">{safetyError}</p>
          </div>
        )}

        <div className="p-6 border-t border-black/5 bg-white/50 backdrop-blur-sm flex justify-end">
          <button
            onClick={handleSubmit}
            disabled={(!content && !url && !videoBase64) || isFetchingLink || isCheckingSafety}
            className="flex items-center gap-2 px-8 py-3 bg-cyan-600 text-white rounded-xl font-bold hover:bg-cyan-700 disabled:opacity-50 shadow-lg active:scale-95"
          >
            {isCheckingSafety ? <Loader2 className="animate-spin" size={18} /> : (initialPost ? <><Save size={18} /> Update</> : <><Send size={18} /> Post</>)}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PostEditor;
