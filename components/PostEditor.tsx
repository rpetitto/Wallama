
import React, { useState, useRef, useEffect } from 'react';
import { PostType, Post } from '../types';
import { X, Image as ImageIcon, Link as LinkIcon, Gift, Video, Sparkles, Send, Camera, StopCircle, Upload, Loader2, Type, Search, Check, Palette, MessageSquare, ShieldAlert, Save, HardDrive, Bold, Italic, Underline, Code, List, ListOrdered, Quote, LayoutGrid, Link as LinkIconSmall } from 'lucide-react';
import { refinePostContent, checkContentSafety } from '../services/geminiService';
import { WALL_COLORS, WALL_GRADIENTS } from '../constants';
import { GoogleGenAI } from "@google/genai";

declare const google: any;

interface PostEditorProps {
  onClose: () => void;
  onSubmit: (post: Partial<Post>) => void;
  authorName: string;
  initialPost?: Post;
  parentId?: string;
}

const GIPHY_API_KEY = 'eo5zSu2rUveZJB4kxO3S1Rv57KkMbhiQ'; 
const GOOGLE_CLIENT_ID = "6888240288-5v0p6nsoi64q1puv1vpvk1njd398ra8b.apps.googleusercontent.com";

const PostEditor: React.FC<PostEditorProps> = ({ onClose, onSubmit, authorName, initialPost, parentId }) => {
  const [type, setType] = useState<PostType>('title');
  const [titleText, setTitleText] = useState('');
  const [content, setContent] = useState('');
  const [caption, setCaption] = useState('');
  const [url, setUrl] = useState('');
  const [headerImage, setHeaderImage] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState(WALL_COLORS[0]);
  const [isRecording, setIsRecording] = useState(false);
  const [videoBase64, setVideoBase64] = useState<string | null>(null);
  const [videoThumbnail, setVideoThumbnail] = useState<string | null>(null);
  const [isRefining, setIsRefining] = useState(false);
  const [isFetchingLink, setIsFetchingLink] = useState(false);
  const [linkMetadata, setLinkMetadata] = useState<any>(null);
  const [isCheckingSafety, setIsCheckingSafety] = useState(false);
  const [safetyError, setSafetyError] = useState<string | null>(null);
  
  // Defaulting to 'upload' and removed 'presets' from types for posts
  const [imagePickerTab, setImagePickerTab] = useState<'upload' | 'drive' | 'url' | 'search'>('upload');
  const [imageSearch, setImageSearch] = useState('');
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [isImageSearching, setIsImageSearching] = useState(false);
  const [driveFiles, setDriveFiles] = useState<any[]>([]);
  const [driveToken, setDriveToken] = useState<string | null>(sessionStorage.getItem('google_drive_token'));

  const [gifSearch, setGifSearch] = useState('');
  const [gifs, setGifs] = useState<any[]>([]);
  const [isSearchingGifs, setIsSearchingGifs] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const driveTokenClient = useRef<any>(null);

  useEffect(() => {
    if (initialPost) {
      const pType = (initialPost.type as string) === 'text' ? 'title' : (initialPost.type as PostType);
      setType(pType);
      setSelectedColor(initialPost.color || WALL_COLORS[0]);
      setCaption(initialPost.metadata?.caption || '');
      if (pType === 'title') {
        setTitleText(initialPost.title || '');
        setContent(initialPost.content || '');
        setHeaderImage(initialPost.metadata?.image || null);
      } else if (pType === 'video') {
         setVideoBase64(initialPost.content);
         setVideoThumbnail(initialPost.metadata?.videoThumbnail || null);
      } else if (pType === 'image' || pType === 'gif') {
         setUrl(initialPost.content);
      } else {
         setUrl(initialPost.content);
         setLinkMetadata(initialPost.metadata);
      }
    }
  }, [initialPost]);

  useEffect(() => {
    if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
      driveTokenClient.current = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        callback: (response: any) => {
          if (response.access_token) {
            sessionStorage.setItem('google_drive_token', response.access_token);
            setDriveToken(response.access_token);
            fetchDriveFiles(response.access_token);
          }
        },
      });
    }
  }, []);

  const fetchDriveFiles = async (token: string, query: string = '') => {
    try {
        let q = "trashed = false and mimeType contains 'image/'";
        if (query) q += ` and name contains '${query}'`;
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&pageSize=20&fields=files(id,name,thumbnailLink,webViewLink,mimeType,iconLink)`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
            const data = await res.json();
            setDriveFiles(data.files || []);
        }
    } catch (e) { console.error(e); }
  };

  const performImageSearch = async () => {
    if (!imageSearch) return;
    setIsImageSearching(true);
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `Find a direct image URL for: "${imageSearch}". Return ONLY the raw URL string.`,
            config: { tools: [{ googleSearch: {} }] }
        });
        const foundUrl = response.text.trim().replace(/`/g, '');
        if (foundUrl.startsWith('http')) {
            if (type === 'title') setHeaderImage(foundUrl);
            else setUrl(foundUrl);
        }
    } catch (e) { console.error(e); } finally { setIsImageSearching(false); }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => { 
        if (type === 'title') setHeaderImage(reader.result as string);
        else setUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
      e.target.value = ''; // Reset input so same file can be selected again
    }
  };

  const insertFormat = (before: string, after: string = '') => {
    if (!textareaRef.current) return;
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const selected = content.substring(start, end);
    const newText = content.substring(0, start) + before + selected + after + content.substring(end);
    setContent(newText);
    setTimeout(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(start + before.length, end + before.length);
    }, 0);
  };

  const searchGifs = async (query: string) => {
    setIsSearchingGifs(true);
    try {
      let endpoint = `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=25&rating=g`;
      if (!query || query === 'trending') endpoint = `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=25&rating=g`;
      const res = await fetch(endpoint);
      const data = await res.json();
      setGifs(data.data || []);
    } catch (err) { console.error(err); } finally { setIsSearchingGifs(false); }
  };

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
      }
    } catch (err) {} finally { setIsFetchingLink(false); }
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
          setVideoThumbnail(null);
        };
        stream.getTracks().forEach(t => t.stop());
      };
      recorder.start();
      setIsRecording(true);
    } catch (err) { alert("Microphone/Camera access required"); }
  };

  const stopRecording = () => { mediaRecorderRef.current?.stop(); setIsRecording(false); };

  const handleSubmit = async () => {
    let submissionTitle = '';
    let submissionContent = content;
    let submissionMetadata: any = { caption };
    setSafetyError(null);

    if (type === 'video') {
      submissionContent = videoBase64 || '';
      submissionMetadata.videoThumbnail = videoThumbnail;
    } else if (type === 'image' || type === 'gif') {
      submissionContent = url;
    } else if (type === 'link' || type === 'drive') {
      submissionContent = url;
      submissionMetadata = { ...submissionMetadata, ...linkMetadata };
    } else if (type === 'title') {
      submissionTitle = titleText;
      submissionContent = content; 
      submissionMetadata.image = headerImage;
    }

    if (!submissionContent && type !== 'title') return;
    if (type === 'title' && !submissionTitle && !submissionContent) return;

    setIsCheckingSafety(true);
    const safetyResult = await checkContentSafety(submissionTitle + ' ' + submissionContent + ' ' + caption, (type === 'image' && url.startsWith('data:')) ? url : undefined);
    if (!safetyResult.isSafe) {
      setIsCheckingSafety(false);
      setSafetyError(safetyResult.reason || "Inappropriate content.");
      return;
    }
    setIsCheckingSafety(false);

    onSubmit({
      type,
      title: submissionTitle,
      content: submissionContent,
      metadata: submissionMetadata,
      color: selectedColor,
      parentId: parentId || undefined
    });
  };

  const imagePicker = (
    <div className="space-y-4">
      <div className="flex gap-2 p-1 bg-black/5 rounded-xl overflow-x-auto">
        {[
          { id: 'upload', icon: Upload, label: 'Upload' },
          { id: 'drive', icon: HardDrive, label: 'Drive' },
          { id: 'url', icon: LinkIconSmall, label: 'URL' },
          { id: 'search', icon: Search, label: 'Search' }
        ].map(tab => (
          <button key={tab.id} onClick={() => setImagePickerTab(tab.id as any)} className={`flex-1 py-2 px-3 rounded-lg flex items-center justify-center gap-2 text-[9px] font-black uppercase tracking-widest transition-all ${imagePickerTab === tab.id ? 'bg-white shadow-sm text-cyan-600' : 'text-slate-500 hover:bg-white/50'}`}>
            <tab.icon size={14} /> {tab.label}
          </button>
        ))}
      </div>
      <div className="min-h-[140px] p-4 bg-black/5 rounded-2xl border border-black/5">
        {imagePickerTab === 'upload' && (
          <div className="flex flex-col items-center justify-center py-4 cursor-pointer" onClick={() => fileInputRef.current?.click()}>
            <Upload className="text-slate-400 mb-2" size={32} />
            <p className="text-xs font-bold text-slate-500">Click to upload</p>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
          </div>
        )}
        {imagePickerTab === 'drive' && (
          <div className="space-y-3">
            {!driveToken ? (
              <button onClick={() => driveTokenClient.current?.requestAccessToken()} className="w-full py-3 bg-slate-800 text-white rounded-xl text-xs font-bold">Connect Drive</button>
            ) : (
              <div className="grid grid-cols-4 gap-2 h-32 overflow-y-auto custom-scrollbar">
                {driveFiles.map(file => (
                  <button key={file.id} onClick={() => { if(type==='title') setHeaderImage(file.thumbnailLink); else setUrl(file.webViewLink); }} className="aspect-square bg-white rounded-lg overflow-hidden border">
                    <img src={file.thumbnailLink} className="w-full h-full object-cover" alt="" referrerPolicy="no-referrer" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {imagePickerTab === 'url' && (
          <div className="flex gap-2">
            <input type="text" placeholder="https://image-url.com/img.jpg" className="flex-1 px-3 py-2 bg-white border border-black/10 rounded-lg text-xs" value={imageUrlInput} onChange={e => setImageUrlInput(e.target.value)} />
            <button onClick={() => { if(type==='title') setHeaderImage(imageUrlInput); else setUrl(imageUrlInput); setImageUrlInput(''); }} className="px-3 py-2 bg-slate-800 text-white rounded-lg text-xs font-bold">Apply</button>
          </div>
        )}
        {imagePickerTab === 'search' && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input type="text" placeholder="Search images..." className="flex-1 px-3 py-2 bg-white border border-black/10 rounded-lg text-xs" value={imageSearch} onChange={e => setImageSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && performImageSearch()} />
              <button onClick={performImageSearch} disabled={isImageSearching} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold">
                {isImageSearching ? <Loader2 className="animate-spin" size={14} /> : 'Go'}
              </button>
            </div>
          </div>
        )}
        {(type === 'title' ? headerImage : url) && (
          <div className="mt-4 flex items-center justify-between">
            <div className={`h-12 w-20 rounded-lg border border-black/10 overflow-hidden ${ (type==='title'?headerImage:url)?.includes('from-') ? 'bg-gradient-to-br '+(type==='title'?headerImage:url) : '' }`}>
               { !(type==='title'?headerImage:url)?.includes('from-') && <img src={type==='title' ? headerImage! : url} className="w-full h-full object-cover" alt="" /> }
            </div>
            <button onClick={() => { if(type==='title') setHeaderImage(null); else setUrl(''); }} className="text-[10px] font-black text-red-500 uppercase tracking-widest">Remove</button>
          </div>
        )}
      </div>
    </div>
  );

  const isHexColor = selectedColor.startsWith('#');

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className={`w-full max-w-xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] transition-colors duration-300 ${!isHexColor && selectedColor === 'bg-white' ? 'bg-white' : (!isHexColor ? selectedColor : '')}`} style={{ backgroundColor: isHexColor ? selectedColor : undefined }}>
        <div className="p-6 border-b border-black/5 flex items-center justify-between bg-white/50 backdrop-blur-sm">
          <h3 className="text-xl font-bold text-slate-800">{initialPost ? 'Edit Post' : 'Create Post'}</h3>
          <button onClick={onClose} className="p-2 hover:bg-black/5 rounded-full transition-colors text-slate-500"><X size={20} /></button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-6 custom-scrollbar">
          <div className="flex gap-2 p-1 bg-black/5 rounded-xl overflow-x-auto">
            {[
              { id: 'title', icon: Type, label: 'Title' },
              { id: 'image', icon: ImageIcon, label: 'Image' },
              { id: 'link', icon: LinkIcon, label: 'Link' },
              { id: 'gif', icon: Gift, label: 'GIF' },
              { id: 'video', icon: Video, label: 'Video' }
            ].map((tab) => (
              <button key={tab.id} onClick={() => { setType(tab.id as PostType); setSafetyError(null); }} className={`flex-1 min-w-[60px] flex flex-col items-center gap-1 py-3 px-2 rounded-lg transition-all ${type === tab.id ? 'bg-white shadow-sm text-cyan-600' : 'text-slate-500 hover:bg-black/5'}`}>
                <tab.icon size={20} />
                <span className="text-[10px] font-bold uppercase tracking-widest">{tab.label}</span>
              </button>
            ))}
          </div>

          <div className="space-y-4">
            {type === 'title' && (
              <div className="space-y-4">
                <div className="space-y-2">
                   <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Header Image (Optional)</label>
                   {imagePicker}
                </div>
                <div className="space-y-2">
                   <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Headline (1-Line)</label>
                   <input type="text" value={titleText} onChange={e => setTitleText(e.target.value)} placeholder="Main Heading..." className="w-full p-4 bg-white/50 border border-black/5 rounded-xl outline-none text-lg font-black text-slate-900" />
                </div>
                <div className="relative">
                  <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Body Text</label>
                  
                  {/* Markdown Toolbar */}
                  <div className="flex flex-wrap gap-1 p-1 bg-black/5 rounded-t-xl border-x border-t border-black/5">
                    <button onClick={() => insertFormat('**', '**')} className="p-2 hover:bg-white rounded-lg text-slate-600" title="Bold"><Bold size={16} /></button>
                    <button onClick={() => insertFormat('_', '_')} className="p-2 hover:bg-white rounded-lg text-slate-600" title="Italic"><Italic size={16} /></button>
                    <button onClick={() => insertFormat('<u>', '</u>')} className="p-2 hover:bg-white rounded-lg text-slate-600" title="Underline"><Underline size={16} /></button>
                    <div className="w-px h-6 bg-black/10 mx-1 self-center" />
                    <button onClick={() => insertFormat('- ')} className="p-2 hover:bg-white rounded-lg text-slate-600" title="Bullet List"><List size={16} /></button>
                    <button onClick={() => insertFormat('1. ')} className="p-2 hover:bg-white rounded-lg text-slate-600" title="Numbered List"><ListOrdered size={16} /></button>
                    <button onClick={() => insertFormat('> ')} className="p-2 hover:bg-white rounded-lg text-slate-600" title="Quote"><Quote size={16} /></button>
                    <button onClick={() => insertFormat('`', '`')} className="p-2 hover:bg-white rounded-lg text-slate-600" title="Code"><Code size={16} /></button>
                  </div>

                  <textarea ref={textareaRef} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Enter details or thoughts..." className="w-full h-32 p-4 bg-white/50 border border-black/5 rounded-b-2xl focus:ring-4 focus:ring-cyan-500/20 focus:border-cyan-500 outline-none resize-none text-base font-medium text-slate-900" />
                  <button onClick={handleRefine} disabled={!content || isRefining} className="absolute bottom-4 right-4 flex items-center gap-2 px-3 py-1.5 bg-cyan-600 text-white rounded-full text-xs font-bold shadow-md transition-all"><Sparkles size={14} /> {isRefining ? '...' : 'AI Refine'}</button>
                </div>
              </div>
            )}

            {type === 'image' && (
              <div className="space-y-2">
                 <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Select Image Content</label>
                 {imagePicker}
              </div>
            )}

            {type === 'link' && (
              <div className="space-y-4">
                <input type="text" value={url} onBlur={() => fetchLinkMetadata(url)} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" className="w-full p-4 bg-white/50 border border-black/5 rounded-xl outline-none text-slate-900 font-bold" />
                {linkMetadata && <div className="p-4 bg-white/60 rounded-2xl border border-black/5 flex gap-4">{linkMetadata.image && <img src={linkMetadata.image} className="h-16 w-16 rounded-lg object-cover" alt="" />}<div className="flex-1"><p className="text-sm font-bold text-slate-900">{linkMetadata.title}</p></div></div>}
              </div>
            )}

            {type === 'gif' && (
              <div className="space-y-4">
                <div className="flex gap-2">
                  <input type="text" value={gifSearch} onChange={(e) => setGifSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchGifs(gifSearch)} placeholder="Search Giphy..." className="flex-1 p-4 bg-white/50 border border-black/5 rounded-xl outline-none" />
                  <button onClick={() => searchGifs(gifSearch)} className="px-6 bg-cyan-600 text-white rounded-xl font-bold">Find</button>
                </div>
                <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto p-1 custom-scrollbar">
                  {gifs.map(gif => (
                    <button key={gif.id} onClick={() => setUrl(gif.images.fixed_height.url)} className={`aspect-square rounded-lg overflow-hidden border-4 transition-all ${url === gif.images.fixed_height.url ? 'border-cyan-600' : 'border-transparent'}`}><img src={gif.images.fixed_height.url} className="w-full h-full object-cover" alt="" /></button>
                  ))}
                </div>
              </div>
            )}

            {type === 'video' && (
              <div className="space-y-4">
                <div className="aspect-video bg-black rounded-2xl overflow-hidden relative shadow-inner">
                  <video ref={videoRef} autoPlay muted playsInline className={`w-full h-full object-cover ${!isRecording && !videoBase64 ? 'hidden' : ''}`} />
                  {videoBase64 && !isRecording && <video ref={previewVideoRef} src={videoBase64} className="w-full h-full object-cover absolute inset-0" />}
                </div>
                <div className="flex justify-center gap-4">
                  {!isRecording ? <button onClick={startRecording} className="px-8 py-3 bg-red-600 text-white rounded-full font-bold">Record</button> : <button onClick={stopRecording} className="px-8 py-3 bg-slate-800 text-white rounded-full font-bold">Stop</button>}
                </div>
              </div>
            )}

            {(type !== 'title') && (
              <div className="pt-2">
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Caption (Optional)</label>
                <input type="text" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Add some context..." className="w-full px-4 py-3 bg-white/50 border border-black/5 rounded-xl outline-none text-sm" />
              </div>
            )}

            <div className="pt-2">
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Card Color</label>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {WALL_COLORS.map(color => (
                  <button key={color} onClick={() => setSelectedColor(color)} style={{ backgroundColor: color }} className={`h-10 w-10 rounded-full border-2 transition-all shrink-0 ${selectedColor === color ? 'border-cyan-600 scale-110 shadow-lg' : 'border-black/10'}`} />
                ))}
              </div>
            </div>
          </div>
        </div>
        
        {safetyError && <div className="mx-6 mb-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-bold">{safetyError}</div>}

        <div className="p-6 border-t border-black/5 bg-white/50 flex justify-end">
          <button onClick={handleSubmit} disabled={isCheckingSafety} className="px-8 py-3 bg-cyan-600 text-white rounded-xl font-bold shadow-lg hover:bg-cyan-700 disabled:opacity-50">
            {isCheckingSafety ? <Loader2 className="animate-spin" size={18} /> : 'Post to Wall'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PostEditor;
