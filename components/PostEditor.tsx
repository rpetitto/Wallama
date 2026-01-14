
import React, { useState, useRef, useEffect } from 'react';
import { PostType, Post } from '../types';
import { X, Image as ImageIcon, Link as LinkIcon, Gift, Video, Sparkles, Send, Camera, StopCircle, Upload, Loader2, Type, Search, Check, Palette, MessageSquare, ShieldAlert, Save } from 'lucide-react';
import { refinePostContent, checkContentSafety } from '../services/geminiService';
import { WALL_COLORS } from '../constants';

interface PostEditorProps {
  onClose: () => void;
  onSubmit: (post: Partial<Post>) => void;
  authorName: string;
  initialPost?: Post;
}

const GIPHY_API_KEY = 'eo5zSu2rUveZJB4kxO3S1Rv57KkMbhiQ'; 

const PostEditor: React.FC<PostEditorProps> = ({ onClose, onSubmit, authorName, initialPost }) => {
  const [type, setType] = useState<PostType>('text');
  const [content, setContent] = useState('');
  const [caption, setCaption] = useState('');
  const [url, setUrl] = useState('');
  const [selectedColor, setSelectedColor] = useState(WALL_COLORS[0]);
  const [isRecording, setIsRecording] = useState(false);
  const [videoBase64, setVideoBase64] = useState<string | null>(null);
  const [isRefining, setIsRefining] = useState(false);
  const [isFetchingLink, setIsFetchingLink] = useState(false);
  const [linkMetadata, setLinkMetadata] = useState<any>(null);
  const [isCheckingSafety, setIsCheckingSafety] = useState(false);
  const [safetyError, setSafetyError] = useState<string | null>(null);
  
  const [gifSearch, setGifSearch] = useState('');
  const [gifs, setGifs] = useState<any[]>([]);
  const [isSearchingGifs, setIsSearchingGifs] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
         // If video content is base64, load it
         setVideoBase64(initialPost.content);
      } else if (initialPost.type === 'link') {
         setUrl(initialPost.content);
         setLinkMetadata(initialPost.metadata);
      } else {
         // Image/GIF
         setUrl(initialPost.content);
      }
    }
  }, [initialPost]);

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
        reader.onloadend = () => { setVideoBase64(reader.result as string); };
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

  const handleSubmit = async () => {
    let submissionContent = content;
    let submissionMetadata: any = {};
    setSafetyError(null);

    if (type === 'video') submissionContent = videoBase64 || '';
    else if (type === 'image' || type === 'gif') submissionContent = url;
    else if (type === 'link') {
      submissionContent = url;
      submissionMetadata = { ...(linkMetadata || { url, title: url }) };
    }

    if (!submissionContent && type !== 'text') return;
    if (type === 'text' && !content) return;

    if (caption) {
      submissionMetadata.caption = caption;
    }
    
    // Preserve existing metadata if updating
    if (initialPost && initialPost.metadata) {
        submissionMetadata = { ...initialPost.metadata, ...submissionMetadata };
    }

    // --- SAFETY CHECK START ---
    setIsCheckingSafety(true);
    
    // 1. Aggregate Text
    const textToCheckParts = [];
    if (type === 'text') textToCheckParts.push(content);
    if (caption) textToCheckParts.push(caption);
    
    // For links, check title and description
    if (type === 'link' && linkMetadata) {
      if (linkMetadata.title) textToCheckParts.push(linkMetadata.title);
      if (linkMetadata.description) textToCheckParts.push(linkMetadata.description);
    }
    // Check URL string itself
    if (url) textToCheckParts.push(url);

    const textToAnalyze = textToCheckParts.join(' ');

    // 2. Identify Image (if any)
    let imageToAnalyze = undefined;
    if (type === 'image' && url.startsWith('data:')) {
        imageToAnalyze = url;
    }

    // 3. Perform Check
    if (textToAnalyze.length > 0 || imageToAnalyze) {
      const safetyResult = await checkContentSafety(textToAnalyze, imageToAnalyze);
      if (!safetyResult.isSafe) {
        setIsCheckingSafety(false);
        setSafetyError(safetyResult.reason || "Content flagged as inappropriate.");
        return; // STOP SUBMISSION
      }
    }
    setIsCheckingSafety(false);
    // --- SAFETY CHECK END ---
    
    onSubmit({
      type,
      content: submissionContent,
      metadata: submissionMetadata,
      color: selectedColor
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
            <h3 className="text-xl font-bold text-slate-800">{initialPost ? 'Edit Post' : 'Add to Wallama'}</h3>
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
              { id: 'gif', icon: Gift, label: 'GIF' },
              { id: 'video', icon: Video, label: 'Video' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => { setType(tab.id as PostType); setContent(''); setUrl(''); setLinkMetadata(null); setSafetyError(null); }}
                className={`flex-1 min-w-[70px] flex flex-col items-center gap-1 py-3 px-2 rounded-lg transition-all ${type === tab.id ? 'bg-white shadow-sm text-cyan-600' : 'text-slate-500 hover:bg-black/5'}`}
              >
                <tab.icon size={20} />
                <span className="text-[10px] font-bold uppercase tracking-widest">{tab.label}</span>
              </button>
            ))}
          </div>

          <div className="space-y-4">
            {type === 'text' && (
              <div className="relative">
                <textarea
                  value={content}
                  onChange={(e) => { setContent(e.target.value); setSafetyError(null); }}
                  placeholder="Type something amazing..."
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
                  <button 
                    onClick={() => searchGifs(gifSearch)}
                    className="flex-shrink-0 px-6 bg-cyan-600 text-white rounded-xl font-bold hover:bg-cyan-700 transition-colors"
                  >
                    Search
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2 max-h-72 overflow-y-auto p-1 custom-scrollbar">
                  {gifs.map(gif => (
                    <button
                      key={gif.id}
                      onClick={() => setUrl(gif.images.fixed_height.url)}
                      className={`relative aspect-square rounded-lg overflow-hidden border-4 transition-all ${url === gif.images.fixed_height.url ? 'border-cyan-600 shadow-lg' : 'border-transparent hover:border-black/10'}`}
                    >
                      <img src={gif.images.fixed_height.url} className="w-full h-full object-cover" alt={gif.title} />
                      {url === gif.images.fixed_height.url && (
                        <div className="absolute inset-0 bg-cyan-600/20 flex items-center justify-center">
                          <Check className="text-white bg-cyan-600 rounded-full p-1" size={24} />
                        </div>
                      )}
                    </button>
                  ))}
                  {!gifs.length && !isSearchingGifs && (
                     <div className="col-span-3 py-8 text-center text-slate-400 text-sm">
                       Try searching for something fun!
                     </div>
                  )}
                </div>
              </div>
            )}

            {type === 'video' && (
              <div className="space-y-4">
                <div className="aspect-video bg-black rounded-2xl overflow-hidden relative shadow-inner">
                  <video ref={videoRef} autoPlay muted playsInline className={`w-full h-full object-cover ${!isRecording && !videoBase64 ? 'hidden' : ''}`} />
                  {videoBase64 && !isRecording && <video src={videoBase64} controls className="w-full h-full object-cover absolute inset-0" />}
                </div>
                <div className="flex justify-center gap-4">
                  {!isRecording ? (
                    <button onClick={startRecording} className="flex items-center gap-2 px-8 py-3 bg-red-600 text-white rounded-full hover:bg-red-700 transition-all font-bold">
                      <Camera size={20} /> {videoBase64 ? 'Record New' : 'Start Recording'}
                    </button>
                  ) : (
                    <button onClick={stopRecording} className="flex items-center gap-2 px-8 py-3 bg-slate-800 text-white rounded-full hover:bg-slate-900 transition-all font-bold animate-pulse">
                      <StopCircle size={20} /> Stop
                    </button>
                  )}
                </div>
              </div>
            )}

            {type === 'image' && (
               <div className="space-y-4">
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full h-48 border-2 border-dashed border-slate-300 rounded-2xl flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-white/50 bg-white/30 group overflow-hidden"
                >
                  {url ? <img src={url} className="w-full h-full object-contain" alt="Preview" /> : <><Upload className="text-slate-400 group-hover:text-slate-600" size={40} /><p className="text-sm font-bold text-slate-500">Upload Image</p></>}
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                </div>
              </div>
            )}

            {/* Caption Field - Available for ALL Types */}
            <div className="pt-2">
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                <MessageSquare size={14} /> Caption (Optional)
              </label>
              <input
                type="text"
                value={caption}
                onChange={(e) => { setCaption(e.target.value); setSafetyError(null); }}
                placeholder="Add a description..."
                className="w-full px-4 py-3 bg-white/50 border border-black/5 rounded-xl outline-none focus:ring-4 focus:ring-cyan-500/20 text-sm text-slate-900 placeholder:text-slate-400"
              />
            </div>

            {/* Color Picker */}
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
                    title={color}
                  />
                ))}
              </div>
            </div>

          </div>
        </div>
        
        {/* Safety Error Display */}
        {safetyError && (
          <div className="mx-6 mb-2 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 animate-in slide-in-from-bottom-2">
             <ShieldAlert className="text-red-500 flex-shrink-0" size={20} />
             <div>
               <p className="text-xs font-bold text-red-600 uppercase tracking-wide">Post Blocked</p>
               <p className="text-sm text-red-700 font-medium leading-tight">{safetyError}</p>
             </div>
          </div>
        )}

        <div className="p-6 border-t border-black/5 bg-white/50 backdrop-blur-sm flex justify-end">
          <button
            onClick={handleSubmit}
            disabled={(!content && !url && !videoBase64) || isFetchingLink || isCheckingSafety}
            className="flex items-center gap-2 px-8 py-3 bg-cyan-600 text-white rounded-xl font-bold hover:bg-cyan-700 disabled:bg-slate-200 disabled:text-slate-400 transition-all shadow-lg active:scale-95"
          >
            {isCheckingSafety ? <Loader2 className="animate-spin" size={18} /> : (initialPost ? <><Save size={18} /> Update</> : <><Send size={18} /> Post</>)}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PostEditor;
