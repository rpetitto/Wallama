
import React, { useState, useRef, useEffect } from 'react';
import { PostType, Post } from '../types';
import { X, Image as ImageIcon, Link as LinkIcon, Gift, Video, Sparkles, Send, Camera, StopCircle, Upload, Loader2, Type, Search, Check, Palette, MessageSquare, ShieldAlert, Save, HardDrive, Bold, Italic, Underline, Code, List, ListOrdered, Quote, LayoutGrid, Link as LinkIconSmall } from 'lucide-react';
import { aiService, databaseService, searchService } from '../lib/api';
import { DRIVE_SCOPES, tokenClient, type TokenClient } from '../lib/google';
import { WALL_COLORS, WALL_GRADIENTS } from '../constants';

interface PostEditorProps {
  onClose: () => void;
  onSubmit: (post: Partial<Post>) => void;
  /** Which wall's media bucket an upload from this editor belongs to. */
  wallId: string;
  authorName: string;
  initialPost?: Post;
  parentId?: string;
  isKanbanColumn?: boolean;
}

/*
 * The Giphy and Pexels keys used to be string literals right here, which meant
 * they were in the bundle every visitor downloads. They are Worker secrets now,
 * and `searchService` asks our own server instead — see src/worker/routes/search.ts.
 */

const PostEditor: React.FC<PostEditorProps> = ({ onClose, onSubmit, wallId, authorName, initialPost, parentId, isKanbanColumn }) => {
  const [type, setType] = useState<PostType>('title');
  const [titleText, setTitleText] = useState('');
  const [content, setContent] = useState('');
  const [caption, setCaption] = useState('');
  const [url, setUrl] = useState('');
  const [headerImage, setHeaderImage] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState(WALL_COLORS[0]);
  const [isRecording, setIsRecording] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoThumbnail, setVideoThumbnail] = useState<string | null>(null);
  const [isFetchingLink, setIsFetchingLink] = useState(false);
  const [linkMetadata, setLinkMetadata] = useState<any>(null);
  const [isCheckingSafety, setIsCheckingSafety] = useState(false);
  const [safetyError, setSafetyError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  /**
   * The R2 key of the file this editor uploaded, if any. The safety check names
   * it instead of re-sending the picture: the server already has the bytes, and
   * shipping a photo back up as base64 to ask about it is the pattern this
   * migration exists to remove.
   */
  const [uploadedMediaKey, setUploadedMediaKey] = useState<string | null>(null);
  
  const [imagePickerTab, setImagePickerTab] = useState<'upload' | 'drive' | 'url' | 'search'>('upload');
  const [imageSearch, setImageSearch] = useState('');
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [isImageSearching, setIsImageSearching] = useState(false);
  const [pexelsImages, setPexelsImages] = useState<any[]>([]);
  const [driveFiles, setDriveFiles] = useState<any[]>([]);
  const [driveToken, setDriveToken] = useState<string | null>(sessionStorage.getItem('google_drive_token'));

  const [gifSearch, setGifSearch] = useState('');
  const [gifs, setGifs] = useState<any[]>([]);
  const [isSearchingGifs, setIsSearchingGifs] = useState(false);
  const [gifError, setGifError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const driveTokenClient = useRef<TokenClient | null>(null);

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
         setVideoUrl(initialPost.content);
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
    let cancelled = false;
    tokenClient(DRIVE_SCOPES, (accessToken) => {
      sessionStorage.setItem('google_drive_token', accessToken);
      setDriveToken(accessToken);
      fetchDriveFiles(accessToken);
    }).then((client) => {
      if (!cancelled) driveTokenClient.current = client;
    });
    return () => { cancelled = true; };
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
    setPexelsImages([]);
    try {
        setPexelsImages(await searchService.images(imageSearch));
    } finally { 
        setIsImageSearching(false); 
    }
  };

  const selectPexelsImage = (photo: any) => {
      const imgUrl = photo.src.large2x || photo.src.large;
      const credit = `Photo by ${photo.photographer} on Pexels`;
      
      if (type === 'title') {
          setHeaderImage(imgUrl);
      } else {
          setUrl(imgUrl);
          if (!caption) setCaption(credit);
      }
  };

  /**
   * Put the picked file on the wall and use the path it comes back with.
   *
   * It used to be read into a base64 data URL and carried in the post row, so a
   * 3MB photo became a 4MB string that everyone looking at the wall
   * re-downloaded on every poll.
   */
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // Reset input so the same file can be picked again
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);
    try {
      const { key, url: uploadedUrl } = await databaseService.uploadMedia(wallId, file);
      setUploadedMediaKey(key);
      if (type === 'title') setHeaderImage(uploadedUrl);
      else setUrl(uploadedUrl);
    } catch (err: any) {
      setUploadError(err?.message ?? "That file couldn't be uploaded.");
    } finally {
      setIsUploading(false);
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
    setGifError(null);
    try {
      const { gifs: found, error } = await searchService.gifs(query);
      setGifs(found);
      if (error) setGifError(error);
      else if (found.length === 0) setGifError(`No GIFs found for "${query}".`);
    } finally { setIsSearchingGifs(false); }
  };

  // The tab shouldn't open onto an empty grid; trending is what the old
  // version's "no query" branch was for, it just never got called.
  useEffect(() => {
    if (type === 'gif' && gifs.length === 0 && !gifError) searchGifs('trending');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const fetchLinkMetadata = async (targetUrl: string) => {
    if (!targetUrl || !targetUrl.startsWith('http')) return;
    setIsFetchingLink(true);
    try {
      const preview = await searchService.linkPreview(targetUrl);
      if (preview) {
        setLinkMetadata({
          title: preview.title,
          description: preview.description,
          image: preview.image,
          url: preview.url,
        });
      }
    } finally { setIsFetchingLink(false); }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (videoRef.current) videoRef.current.srcObject = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        // MediaRecorder labels its output by what it actually produced, which is
        // usually webm — the old code asserted mp4 regardless, and the server
        // has to know the real type to store and serve it.
        const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
        setIsUploading(true);
        setUploadError(null);
        try {
          const { key, url: uploadedUrl } = await databaseService.uploadMedia(wallId, blob);
          setUploadedMediaKey(key);
          setVideoUrl(uploadedUrl);
          setVideoThumbnail(null);
        } catch (err: any) {
          setUploadError(err?.message ?? "That recording couldn't be uploaded.");
        } finally {
          setIsUploading(false);
        }
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
      submissionContent = videoUrl || '';
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
    if (type === 'title' && !submissionTitle && !submissionContent && !isKanbanColumn) return;
    if (isKanbanColumn && !submissionTitle && !submissionContent) return;

    // Safety Check
    const textContentForSafety = (type === 'title' || type === 'text' || type === 'link' || type === 'drive') ? submissionContent : '';
    const safetyPayload = `${submissionTitle} ${textContentForSafety} ${caption}`.trim();

    setIsCheckingSafety(true);
    const safetyResult = await aiService.checkContentSafety(
        safetyPayload,
        type === 'image' && uploadedMediaKey ? uploadedMediaKey : undefined,
    );
    
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
      <div className="grid grid-cols-4 gap-1 sm:gap-2 p-1 bg-black/5 rounded-xl">
        {[
          { id: 'upload', icon: Upload, label: 'Upload' },
          { id: 'drive', icon: HardDrive, label: 'Drive' },
          { id: 'url', icon: LinkIconSmall, label: 'URL' },
          { id: 'search', icon: Search, label: 'Search' }
        ].map(tab => (
          <button key={tab.id} onClick={() => setImagePickerTab(tab.id as any)} className={`py-2.5 sm:py-2 px-1 sm:px-3 rounded-lg flex items-center justify-center gap-1 sm:gap-2 text-[9px] font-black uppercase tracking-widest transition-all ${imagePickerTab === tab.id ? 'bg-white shadow-sm text-cyan-600' : 'text-slate-500 hover:bg-white/50'}`}>
            <tab.icon size={14} /> {tab.label}
          </button>
        ))}
      </div>
      <div className="min-h-[140px] p-4 bg-black/5 rounded-2xl border border-black/5">
        {imagePickerTab === 'upload' && (
          <div className="flex flex-col items-center justify-center py-4 cursor-pointer" onClick={() => !isUploading && fileInputRef.current?.click()}>
            {isUploading
              ? <Loader2 className="text-cyan-600 mb-2 animate-spin" size={32} />
              : <Upload className="text-slate-400 mb-2" size={32} />}
            <p className="text-xs font-bold text-slate-500">{isUploading ? 'Uploading…' : 'Click to upload'}</p>
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
                  <button key={file.id} onClick={() => { if(type==='title') setHeaderImage(file.thumbnailLink); else setUrl(file.webViewLink); }} className="h-24 w-full bg-white rounded-lg overflow-hidden border">
                    <img src={file.thumbnailLink} className="w-full h-full object-cover" alt="" referrerPolicy="no-referrer" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {imagePickerTab === 'url' && (
          <div className="flex gap-2">
            <input type="text" placeholder="https://image-url.com/img.jpg" className="flex-1 px-3 py-2 bg-white border border-black/10 rounded-lg text-xs text-slate-900" value={imageUrlInput} onChange={e => setImageUrlInput(e.target.value)} />
            <button onClick={() => { if(type==='title') setHeaderImage(imageUrlInput); else setUrl(imageUrlInput); setImageUrlInput(''); }} className="px-3 py-2 bg-slate-800 text-white rounded-lg text-xs font-bold">Apply</button>
          </div>
        )}
        {imagePickerTab === 'search' && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input type="text" placeholder="Search images..." className="flex-1 px-3 py-2 bg-white border border-black/10 rounded-lg text-xs text-slate-900" value={imageSearch} onChange={e => setImageSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && performImageSearch()} />
              <button onClick={performImageSearch} disabled={isImageSearching} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold">
                {isImageSearching ? <Loader2 className="animate-spin" size={14} /> : 'Go'}
              </button>
            </div>
            {pexelsImages.length > 0 && (
                 <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto p-1 custom-scrollbar">
                    {pexelsImages.map((photo) => (
                         <button 
                            key={photo.id} 
                            onClick={() => selectPexelsImage(photo)}
                            className="h-20 w-full relative rounded-lg overflow-hidden border-2 border-transparent hover:border-cyan-500 transition-all group"
                         >
                            <img src={photo.src.tiny} className="w-full h-full object-cover" alt={photo.alt} />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                         </button>
                    ))}
                 </div>
            )}
            {pexelsImages.length === 0 && !isImageSearching && imageSearch && (
                <p className="text-center text-xs text-slate-400 py-2">No results found.</p>
            )}
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
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
      {/*
        On a phone this is a bottom sheet rather than a centred card: it can use
        the whole height, and when the keyboard comes up for the text field the
        sheet scrolls with it instead of being covered by it.
      */}
      <div className={`w-full max-w-xl rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[100dvh] sm:max-h-[90dvh] transition-colors duration-300 ${!isHexColor && selectedColor === 'bg-white' ? 'bg-white' : (!isHexColor ? selectedColor : '')}`} style={{ backgroundColor: isHexColor ? selectedColor : undefined }}>
        <div className="p-4 sm:p-6 border-b border-black/5 flex items-center justify-between bg-white/50 backdrop-blur-sm">
          <h3 className="text-xl font-bold text-slate-800">{initialPost ? 'Edit Post' : (isKanbanColumn ? 'New Category' : 'Create Post')}</h3>
          <button onClick={onClose} aria-label="Close" className="p-2 hover:bg-black/5 rounded-full transition-colors text-slate-500"><X size={20} /></button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-5 sm:space-y-6 custom-scrollbar">
          {!isKanbanColumn && (
              <div className="grid grid-cols-5 gap-1 sm:gap-2 p-1 bg-black/5 rounded-xl">
                {[
                  { id: 'title', icon: Type, label: 'Title' },
                  { id: 'image', icon: ImageIcon, label: 'Image' },
                  { id: 'link', icon: LinkIcon, label: 'Link' },
                  { id: 'gif', icon: Gift, label: 'GIF' },
                  { id: 'video', icon: Video, label: 'Video' }
                ].map((tab) => (
                  <button key={tab.id} onClick={() => { setType(tab.id as PostType); setSafetyError(null); }} className={`min-w-0 flex flex-col items-center gap-1 py-2.5 sm:py-3 px-1 sm:px-2 rounded-lg transition-all ${type === tab.id ? 'bg-white shadow-sm text-cyan-600' : 'text-slate-500 hover:bg-black/5'}`}>
                    <tab.icon size={20} />
                    <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest">{tab.label}</span>
                  </button>
                ))}
              </div>
          )}

          <div className="space-y-4">
            {type === 'title' && (
              <div className="space-y-4">
                {!isKanbanColumn && (
                    <div className="space-y-2">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Header Image (Optional)</label>
                    {imagePicker}
                    </div>
                )}
                <div className="space-y-2">
                   <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">{isKanbanColumn ? 'Category Name' : 'Headline (1-Line)'}</label>
                   <input type="text" value={titleText} onChange={e => setTitleText(e.target.value)} placeholder={isKanbanColumn ? "e.g. To Do, In Progress" : "Main Heading..."} className="w-full p-4 bg-white/50 border border-black/5 rounded-xl outline-none text-lg font-black text-slate-900" />
                </div>
                {!isKanbanColumn && (
                    <div className="relative">
                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Body Text</label>
                    
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
                    </div>
                )}
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
                  <input type="text" value={gifSearch} onChange={(e) => setGifSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchGifs(gifSearch)} placeholder="Search Giphy..." className="flex-1 p-4 bg-white/50 border border-black/5 rounded-xl outline-none text-slate-900" />
                  <button onClick={() => searchGifs(gifSearch)} disabled={isSearchingGifs} className="px-6 bg-cyan-600 text-white rounded-xl font-bold disabled:opacity-60">{isSearchingGifs ? <Loader2 size={18} className="animate-spin" /> : 'Find'}</button>
                </div>
                {gifError && <p className="text-xs font-bold text-red-500">{gifError}</p>}
                <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto p-1 custom-scrollbar">
                  {gifs.map(gif => (
                    <button key={gif.id} onClick={() => setUrl(gif.images.fixed_height.url)} className={`h-24 w-full rounded-lg overflow-hidden border-4 transition-all ${url === gif.images.fixed_height.url ? 'border-cyan-600' : 'border-transparent'}`}><img src={gif.images.fixed_height.url} className="w-full h-full object-cover" alt="" /></button>
                  ))}
                </div>
              </div>
            )}

            {type === 'video' && (
              <div className="space-y-4">
                <div className="aspect-video bg-black rounded-2xl overflow-hidden relative shadow-inner">
                  <video ref={videoRef} autoPlay muted playsInline className={`w-full h-full object-cover ${!isRecording && !videoUrl ? 'hidden' : ''}`} />
                  {videoUrl && !isRecording && <video ref={previewVideoRef} src={videoUrl} className="w-full h-full object-cover absolute inset-0" />}
                </div>
                <div className="flex justify-center gap-4">
                  {!isRecording ? <button onClick={startRecording} className="px-8 py-3 bg-red-600 text-white rounded-full font-bold">Record</button> : <button onClick={stopRecording} className="px-8 py-3 bg-slate-800 text-white rounded-full font-bold">Stop</button>}
                </div>
              </div>
            )}

            {(type !== 'title' && !isKanbanColumn) && (
              <div className="pt-2">
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Caption (Optional)</label>
                <input type="text" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Add some context..." className="w-full px-4 py-3 bg-white/50 border border-black/5 rounded-xl outline-none text-sm text-slate-900" />
              </div>
            )}

            <div className="pt-2">
              <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-3">{isKanbanColumn ? 'Category Color' : 'Card Color'}</label>
              <div className="flex flex-wrap gap-3">
                {WALL_COLORS.map(color => (
                  <button key={color} onClick={() => setSelectedColor(color)} style={{ backgroundColor: color }} className={`h-10 w-10 rounded-full border-2 transition-all shrink-0 ${selectedColor === color ? 'border-cyan-600 scale-110 shadow-lg' : 'border-black/10'}`} />
                ))}
              </div>
            </div>
          </div>
        </div>
        
        {safetyError && <div className="mx-6 mb-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-bold">{safetyError}</div>}
        {uploadError && <div className="mx-6 mb-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-bold">{uploadError}</div>}

        <div className="p-4 sm:p-6 pb-[calc(env(safe-area-inset-bottom)_+_1rem)] sm:pb-6 border-t border-black/5 bg-white/50 flex justify-end">
          {/* Posting while the file is still going up would save a post whose
              picture doesn't exist yet. */}
          <button onClick={handleSubmit} disabled={isCheckingSafety || isUploading} className="px-8 py-3 bg-cyan-600 text-white rounded-xl font-bold shadow-lg hover:bg-cyan-700 disabled:opacity-50">
            {isCheckingSafety || isUploading ? <Loader2 className="animate-spin" size={18} /> : (isKanbanColumn ? 'Create Category' : 'Post to Wall')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PostEditor;
